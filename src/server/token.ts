import { createHash, timingSafeEqual } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { env } from '@server/env';

// Hash both sides so the buffers have equal length and the compare is constant-time.
const digest = (v: string) => createHash('sha256').update(v).digest();
const expected = digest(env.APP_TOKEN);

/** Gate for the `/:token` sub-app. A wrong token gets a bare 404 so nothing reveals the app. */
export const tokenGate = createMiddleware(async (c, next) => {
  const given = c.req.param('token') ?? '';
  if (!timingSafeEqual(digest(given), expected)) {
    return c.body(null, 404);
  }
  await next();
});

const expectedConnectCode = env.MCP_CONNECT_CODE ? digest(env.MCP_CONNECT_CODE) : null;

/**
 * Constant-time check of the MCP consent secret. Only the consent form uses it, never the gate,
 * and `APP_TOKEN` is never accepted here. False when MCP_CONNECT_CODE is unset.
 */
export function isConnectCode(given: string): boolean {
  const ok = timingSafeEqual(digest(given), expectedConnectCode ?? digest(''));
  return expectedConnectCode !== null && ok;
}
