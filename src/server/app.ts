import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { logger } from '@server/logger';
import { api } from '@server/routes/api';
import { oauth } from '@server/routes/oauth';
import { stremio } from '@server/routes/stremio';
import { tokenGate } from '@server/token';

const WEB_ROOT = path.join(process.cwd(), 'dist', 'web');
const stripToken = (p: string) => p.replace(/^\/[^/]+/, '');

let indexTemplate: string | null = null;
async function renderIndex(token: string): Promise<string | null> {
  try {
    indexTemplate ??= await readFile(path.join(WEB_ROOT, 'index.html'), 'utf8');
  } catch {
    return null;
  }
  // The token is URL-safe (validated in env.ts), so injecting it here is safe.
  return indexTemplate.replace('<head>', `<head>\n    <base href="/${token}/" />`);
}

// Typed part: the RPC client is created with baseUrl `/<token>/`, so AppType is the gated app.
const gated = new Hono().use(tokenGate).route('/api', api).route('/stremio', stremio);

// SPA routes (`/`, `/add`) get index.html with <base> injected. File-like paths go to static
// files below; api/stremio never fall back to HTML.
gated.get('*', async (c, next) => {
  const rest = stripToken(c.req.path);
  if (/^\/(api|stremio)(\/|$)/.test(rest)) return c.notFound();
  if (/\.[a-z0-9]+$/i.test(rest)) return next();
  const html = await renderIndex(c.req.param('token') ?? '');
  if (!html) {
    logger.child({ function: 'spaFallback' }).warn('dist/web/index.html not found (run pnpm build)');
    return c.notFound();
  }
  c.header('Cache-Control', 'no-cache');
  return c.html(html);
});

gated.get(
  '*',
  serveStatic({
    root: path.relative(process.cwd(), WEB_ROOT) || '.',
    rewriteRequestPath: stripToken,
    onFound: (filePath, c) => {
      // The SW and manifest must be revalidated; hashed assets never change.
      if (/(^|[\\/])(sw\.js|manifest\.webmanifest|index\.html)$/.test(filePath)) {
        c.header('Cache-Control', 'no-cache');
      } else if (filePath.includes('assets')) {
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);

export type AppType = typeof gated;

export const app = new Hono();

// Registered before secureHeaders so it runs after it on the way out. Hono's default
// Cross-Origin-Opener-Policy: same-origin would sever a consent popup from its opener.
app.use('/oauth/authorize', async (c, next) => {
  await next();
  c.res.headers.delete('Cross-Origin-Opener-Policy');
});
app.use(
  secureHeaders({
    referrerPolicy: 'no-referrer',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    // Stremio fetches the addon cross-origin; CORS is handled on those routes only.
    crossOriginResourcePolicy: false,
    // No form-action on purpose: browsers apply it to the 303 redirect after a form post, and the
    // consent form redirects to the client's callback.
    // The SPA only loads its own assets, TMDB posters, and inline styles from Radix/Tailwind.
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'https://image.tmdb.org', 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Workbox's cache-first poster fetch runs in the SW, which is governed by connect-src.
      connectSrc: ["'self'", 'https://image.tmdb.org'],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  }),
);
app.use(async (c, next) => {
  await next();
  c.header('X-Robots-Tag', 'noindex');
});

// Log method and status only; the path contains the token.
app.use(async (c, next) => {
  await next();
  logger.child({ function: 'request' }).debug({ method: c.req.method, status: c.res.status });
});

// The MCP OAuth routes are the one fixed exception to the gate (see CLAUDE.md). Each is an exact
// path and method; anything else falls through to the gate, where `oauth`, `mcp` or `.well-known`
// can't equal APP_TOKEN, so it is still a bare 404.
app.route('/', oauth);
app.route('/:token', gated);
app.notFound((c) => c.body(null, 404));
app.onError((err, c) => {
  // zValidator throws HTTPException(400) on malformed JSON; keep client errors out of the 500 path.
  if (err instanceof HTTPException && err.status < 500) {
    return c.json({ error: 'Invalid input' }, err.status);
  }
  logger.child({ function: 'onError' }).error({ err: err.message }, 'Unhandled error');
  return c.json({ error: 'Internal error' }, 500);
});

