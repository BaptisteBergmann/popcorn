import { randomUUID } from 'node:crypto';
import { asc, count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { HtmlEscapedString } from 'hono/utils/html';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { csrf } from 'hono/csrf';
import { instructionsFor, registerTools } from '@server/mcp_tools';
import { db } from '@server/db';
import { OAUTH_AUTH_METHODS, members, oauthClients, type OAuthAuthMethod } from '@server/db/schema';
import { logger } from '@server/logger';
import { authenticateClient, generateClientSecret, sha256Hex } from '@server/oauth/clients';
import { buildClientRedirect, parseAuthorizeRequest } from '@server/oauth/authorize_request';
import type { AuthorizeRequest } from '@server/oauth/authorize_request';
import {
  failPage,
  invalidPage,
  limitPage,
  memberStepPage,
  noMembersPage,
  ratePage,
  secretStepPage,
} from '@server/oauth/consent_page';
import { OAUTH_SCOPE, MAX_CLIENTS, currentConnectCodeTag, oauthUrls } from '@server/oauth/config';
import { createTicket, verifyTicket } from '@server/oauth/ticket';
import {
  isFormContentType,
  noStoreJson,
  oauthError,
  readCappedText,
  tooManyRequests,
} from '@server/oauth/http';
import { authorizationServerMetadata, protectedResourceMetadata } from '@server/oauth/metadata';
import { isAllowedRedirectUri } from '@server/oauth/redirect_uri';
import {
  createGrant,
  grantLimitReached,
  issueTokensForCode,
  resolveAccessToken,
  revokeGrantByToken,
  rotateRefreshToken,
  sweepOAuth,
} from '@server/oauth/tokens';
import type { TokenGrantResult } from '@server/oauth/tokens';
import { isConnectCode } from '@server/token';
import {
  consentGlobalFailures,
  consentIpFailures,
  getClientIp,
  mcpCallLimiter,
  mcpFailedAuthLimiter,
  registerGlobalLimiter,
  registerIpLimiter,
  revokeIpLimiter,
  tokenFailureLimiter,
  tokenIpLimiter,
} from '@server/rate_limit';

// Public OAuth surface for MCP clients, mounted before the token gate. This is the fixed list in
// CLAUDE.md: anything else still falls through to the gate and gets a bare 404.

// state (up to 4096) plus the other fields and the connect code fit well within this.
type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

const MAX_CONSENT_BODY_BYTES = 16 * 1024;
const MAX_CLIENT_NAME = 100;
const MAX_REDIRECT_URIS = 10;

// Temporary: finds the exact Gemini callback to pin on the allowlist. Its host serves many Google
// projects, so the allowlist must match the full URI. Limited to this one host and a path charset.
function geminiRedirectPaths(uris: unknown): string[] {
  if (!Array.isArray(uris)) return [];
  const paths = new Set<string>();
  for (const uri of uris.slice(0, MAX_REDIRECT_URIS)) {
    if (typeof uri !== 'string') continue;
    try {
      const url = new URL(uri);
      if (
        url.protocol === 'https:' &&
        url.hostname === 'oauth-redirect.googleusercontent.com' &&
        /^\/[A-Za-z0-9._~/-]{0,200}$/.test(url.pathname)
      ) {
        paths.add(url.pathname);
      }
    } catch {
      // Not a URL: nothing to report.
    }
  }
  return [...paths];
}
// Hostnames only, so paths and query strings stay out of the logs. Used to find a new client's host
// for the allowlist. This endpoint is public, so the values are capped and limited to a hostname charset.
function rejectedRedirectHosts(uris: unknown): string[] {
  if (!Array.isArray(uris)) return [];
  const hosts = new Set<string>();
  for (const uri of uris.slice(0, MAX_REDIRECT_URIS)) {
    if (typeof uri !== 'string' || isAllowedRedirectUri(uri)) continue;
    try {
      const { hostname } = new URL(uri);
      if (/^[a-z0-9.-]{1,100}$/.test(hostname)) hosts.add(hostname);
    } catch {
      // Not a URL: nothing to report.
    }
  }
  return [...hosts];
}

function sanitizeClientName(value: unknown): string {
  if (typeof value !== 'string') return 'MCP client';
  // Control, bidi and zero-width characters could spoof the consent page.
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, MAX_CLIENT_NAME).join('') || 'MCP client';
}

const isSubsetOf = (value: unknown, allowed: readonly string[]) =>
  Array.isArray(value) && value.every((v) => typeof v === 'string' && allowed.includes(v));

let warnedNoConnectCode = false;

// The consent pages hold the connect code form and member names: never cache them.
const page = (c: Context, body: Html, status: ContentfulStatusCode = 200, headers: Record<string, string> = {}) => {
  c.header('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) c.header(k, v);
  return c.html(body, status);
};

// Only these fields are read from a consent POST; everything else in the body is ignored.
const REQUEST_FIELDS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'resource',
] as const;

const memberList = () =>
  db
    .select({ id: members.id, name: members.name })
    .from(members)
    .orderBy(asc(members.nameKey), asc(members.id))
    .all();

const redirectWith = (c: Context, r: AuthorizeRequest, params: Record<string, string | null>) =>
  c.redirect(buildClientRedirect(r.redirectUri, { ...params, state: r.state }), 303);

// The resource_metadata hint is how OAuth-only clients discover the authorization server. Every
// failure returns the same body, and the token is never logged.
const unauthorized = (c: Context, tokenSent: boolean) => {
  const params = [`resource_metadata="${oauthUrls.prmUrl}"`, `scope="${OAUTH_SCOPE}"`];
  if (tokenSent) params.unshift('error="invalid_token"');
  return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': `Bearer ${params.join(', ')}` });
};

export const oauth = new Hono()
  // Stateless Streamable HTTP. The token comes from the Authorization header only, which browsers
  // never attach on their own. `Origin` isn't validated (a spec deviation): there is no cookie
  // for a browser to ride on, and a bearer header can't be forged cross-site.
  .all('/mcp', async (c) => {
    const contextLogger = logger.child({ function: 'mcpRoute' });
    const match = /^Bearer (\S+)$/i.exec(c.req.header('authorization') ?? '');
    const grant = match ? resolveAccessToken(match[1]!) : null;

    if (!grant) {
      if (!mcpFailedAuthLimiter.hit(getClientIp(c.req.raw.headers))) {
        contextLogger.warn('Too many failed MCP auth attempts');
        return c.json({ error: 'too_many_requests' }, 429, { 'Retry-After': '900' });
      }
      return unauthorized(c, match !== null);
    }
    if (!mcpCallLimiter.hit(grant.grantId)) {
      contextLogger.warn({ grantId: grant.grantId }, 'MCP grant rate limited');
      return c.json({ error: 'too_many_requests' }, 429, { 'Retry-After': '60' });
    }

    // One lightweight server per request, so the verified member travels by closure instead of
    // shared state. maxSubscriptions 0 rejects listen streams, so no long-lived SSE is opened.
    const handler = createMcpHandler(
      () => {
        const server = new McpServer(
          { name: 'popcorn', version: '1.0.0' },
          { instructions: instructionsFor(grant.memberName) },
        );
        registerTools(server, { memberName: grant.memberName, grantId: grant.grantId });
        return server;
      },
      {
        legacy: 'stateless',
        maxSubscriptions: 0,
        maxRequestBodySize: 64 * 1024,
        // Error text can echo request content, so log the class only.
        onerror: (err) => contextLogger.warn({ errorClass: err.constructor.name }, 'MCP handler error'),
      },
    );
    return handler.fetch(c.req.raw);
  })
  .get('/.well-known/oauth-protected-resource', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(protectedResourceMetadata());
  })
  .get('/.well-known/oauth-protected-resource/mcp', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(protectedResourceMetadata());
  })
  .get('/.well-known/oauth-authorization-server', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(authorizationServerMetadata());
  })
  // RFC 7591 open dynamic registration. Writes nothing but a client row, which grants nothing
  // until someone enters the connect code on the consent page.
  .post('/oauth/register', async (c) => {
    const contextLogger = logger.child({ function: 'registerOAuthClient' });
    const ip = getClientIp(c.req.raw.headers);
    if (!registerIpLimiter.hit(ip) || !registerGlobalLimiter.hit('all')) {
      contextLogger.warn('OAuth registration rate limited');
      return tooManyRequests(c, 3600);
    }

    const raw = await readCappedText(c.req.raw);
    if (raw === null) return oauthError(c, 'invalid_client_metadata', 'Request body too large', 413);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return oauthError(c, 'invalid_client_metadata', 'Body must be JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return oauthError(c, 'invalid_client_metadata', 'Body must be a JSON object');
    }
    const meta = body as Record<string, unknown>;

    // Keep the URIs that pass and drop the rest: some clients send a batch where only some would be
    // accepted. A dropped URI can never be used, since authorize matches against the stored list.
    const uris = meta.redirect_uris;
    const redirectUris = Array.isArray(uris) ? Array.from(new Set(uris.filter(isAllowedRedirectUri))) : [];
    if (redirectUris.length < 1 || redirectUris.length > MAX_REDIRECT_URIS) {
      contextLogger.warn(
        {
          given: Array.isArray(uris) ? uris.length : 0,
          rejectedHosts: rejectedRedirectHosts(uris),
          geminiPaths: geminiRedirectPaths(uris),
        },
        'Registration rejected: redirect_uris',
      );
      return oauthError(
        c,
        'invalid_redirect_uri',
        `redirect_uris must hold 1 to ${MAX_REDIRECT_URIS} allowed URIs without fragment`,
      );
    }

    if (meta.grant_types !== undefined && !isSubsetOf(meta.grant_types, ['authorization_code', 'refresh_token'])) {
      return oauthError(c, 'invalid_client_metadata', 'Unsupported grant_types');
    }
    if (meta.response_types !== undefined && !isSubsetOf(meta.response_types, ['code'])) {
      return oauthError(c, 'invalid_client_metadata', 'Unsupported response_types');
    }

    const method = meta.token_endpoint_auth_method ?? 'none';
    if (typeof method !== 'string' || !(OAUTH_AUTH_METHODS as readonly string[]).includes(method)) {
      return oauthError(c, 'invalid_client_metadata', 'Unsupported token_endpoint_auth_method');
    }
    const authMethod = method as OAuthAuthMethod;

    sweepOAuth();
    const total = db.select({ n: count() }).from(oauthClients).get()?.n ?? 0;
    if (total >= MAX_CLIENTS) {
      contextLogger.warn('OAuth client table full');
      return oauthError(c, 'server_error', undefined, 503, { 'Retry-After': '3600' });
    }

    const clientName = sanitizeClientName(meta.client_name);
    const secret = authMethod === 'none' ? null : generateClientSecret();
    const id = randomUUID();
    const createdAt = Date.now();
    db.insert(oauthClients)
      .values({
        id,
        clientName,
        redirectUris: JSON.stringify(redirectUris),
        authMethod,
        clientSecretHash: secret ? sha256Hex(secret) : null,
        createdAt,
      })
      .run();
    contextLogger.info({ clientId: id }, 'OAuth client registered');

    return noStoreJson(
      c,
      {
        client_id: id,
        client_id_issued_at: Math.floor(createdAt / 1000),
        client_name: clientName,
        redirect_uris: redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: authMethod,
        scope: OAUTH_SCOPE,
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      },
      201,
    );
  })
  // RFC 6749 section 3.2. Authenticates the client itself and never reads cookies. Never log
  // codes, verifiers, secrets or tokens.
  .post('/oauth/token', async (c) => {
    const contextLogger = logger.child({ function: 'oauthToken' });
    const ip = getClientIp(c.req.raw.headers);

    if (!tokenIpLimiter.hit(ip) || tokenFailureLimiter.isLimited(ip)) {
      contextLogger.warn('OAuth token endpoint rate limited');
      return tooManyRequests(c, 900);
    }

    let grantType: string | null = null;
    let clientIdForLog: string | null = null;
    // Third-party clients only ever see the error code, so log why (enums only).
    const reject = (reason: string, why?: string, countsAsFailure = false) => {
      contextLogger.warn({ reason, why, grantType, clientId: clientIdForLog }, 'OAuth token request rejected');
      if (countsAsFailure) tokenFailureLimiter.hit(ip);
    };

    if (!isFormContentType(c)) {
      reject('content_type');
      return oauthError(c, 'invalid_request', 'Content-Type must be application/x-www-form-urlencoded');
    }
    const raw = await readCappedText(c.req.raw);
    if (raw === null) {
      reject('body_too_large');
      return oauthError(c, 'invalid_request', 'Request body too large', 413);
    }
    const body = new URLSearchParams(raw);
    const rawGrantType = body.get('grant_type');
    grantType = rawGrantType === 'authorization_code' || rawGrantType === 'refresh_token' ? rawGrantType : null;

    const auth = authenticateClient(c.req.raw.headers, body);
    if (auth.status === 'invalid_client') {
      reject('invalid_client', auth.why, true);
      return oauthError(
        c,
        'invalid_client',
        undefined,
        401,
        c.req.header('authorization') ? { 'WWW-Authenticate': 'Basic' } : {},
      );
    }
    const clientId = auth.client.id;
    clientIdForLog = clientId;

    const resource = body.get('resource');
    let result: TokenGrantResult;
    if (grantType === 'authorization_code') {
      const code = body.get('code');
      const redirectUri = body.get('redirect_uri');
      const codeVerifier = body.get('code_verifier');
      if (!code || !redirectUri || !codeVerifier) {
        reject('missing_params');
        return oauthError(c, 'invalid_request', 'code, redirect_uri and code_verifier are required');
      }
      if (resource && resource !== oauthUrls.mcpResource) {
        reject('invalid_target');
        return oauthError(c, 'invalid_target');
      }
      result = issueTokensForCode({ code, clientId, redirectUri, codeVerifier, resource });
    } else if (grantType === 'refresh_token') {
      const refreshToken = body.get('refresh_token');
      if (!refreshToken) {
        reject('missing_params');
        return oauthError(c, 'invalid_request', 'refresh_token is required');
      }
      if (resource && resource !== oauthUrls.mcpResource) {
        reject('invalid_target');
        return oauthError(c, 'invalid_target');
      }
      result = rotateRefreshToken({ refreshToken, clientId });
    } else {
      reject('unsupported_grant_type');
      return oauthError(c, 'unsupported_grant_type');
    }

    if (result.status === 'invalid_grant') {
      reject('invalid_grant', result.why, true);
      return oauthError(c, 'invalid_grant');
    }

    return noStoreJson(c, {
      access_token: result.accessToken,
      token_type: 'Bearer',
      expires_in: result.expiresIn,
      refresh_token: result.refreshToken,
      scope: result.scope,
    });
  })
  // RFC 7009. Authenticated as the client; revokes the whole grant when the token belongs to it.
  // Always 200 for unknown tokens so it can't be used as an oracle.
  .post('/oauth/revoke', async (c) => {
    if (!revokeIpLimiter.hit(getClientIp(c.req.raw.headers))) return tooManyRequests(c, 60);

    if (!isFormContentType(c)) {
      return oauthError(c, 'invalid_request', 'Content-Type must be application/x-www-form-urlencoded');
    }
    const raw = await readCappedText(c.req.raw);
    if (raw === null) return oauthError(c, 'invalid_request', 'Request body too large', 413);
    const body = new URLSearchParams(raw);

    const auth = authenticateClient(c.req.raw.headers, body);
    if (auth.status === 'invalid_client') return oauthError(c, 'invalid_client', undefined, 401);

    const token = body.get('token');
    if (!token) return oauthError(c, 'invalid_request', 'token is required');

    revokeGrantByToken(token, auth.client.id);
    return noStoreJson(c, {});
  })
  // Consent step 1. Validates everything and shows the connect code field; no member names yet.
  .get('/oauth/authorize', (c) => {
    try {
      if (!currentConnectCodeTag) {
        if (!warnedNoConnectCode) {
          warnedNoConnectCode = true;
          logger.child({ function: 'authorize' }).warn('MCP_CONNECT_CODE is not set: MCP sign-in is disabled');
        }
        return page(c, invalidPage(), 400);
      }
      const parsed = parseAuthorizeRequest(new URL(c.req.url).searchParams);
      if (parsed.kind === 'error_page') return page(c, invalidPage(), 400);
      if (parsed.kind === 'redirect_error') return c.redirect(parsed.url, 303);
      return page(c, secretStepPage(parsed.request));
    } catch (err) {
      // A browser user would otherwise see the raw JSON from app.onError.
      logger
        .child({ function: 'authorizeGet' })
        .error({ err: err instanceof Error ? err.message : 'unknown' }, 'Consent page failed');
      return page(c, failPage(), 500);
    }
  })
  // Consent steps 2 to 4. csrf() here only: token and revoke are form posts from non-browsers.
  // Under Referrer-Policy: no-referrer browsers send `Origin: null`, so Sec-Fetch-Site: same-origin
  // is what lets a real submit through.
  .post('/oauth/authorize', csrf(), async (c) => {
    const contextLogger = logger.child({ function: 'authorizePost' });
    try {
      if (!currentConnectCodeTag || !isFormContentType(c)) return page(c, invalidPage(), 400);
      const raw = await readCappedText(c.req.raw, MAX_CONSENT_BODY_BYTES);
      if (raw === null) return page(c, invalidPage(), 413);
      // The body carries the connect code: it is parsed and never logged.
      const form = new URLSearchParams(raw);
      const params = new URLSearchParams();
      for (const field of REQUEST_FIELDS) {
        // Repeated fields stay repeated so the parser rejects them.
        for (const v of form.getAll(field)) params.append(field, v);
      }
      const parsed = parseAuthorizeRequest(params);
      if (parsed.kind === 'error_page') return page(c, invalidPage(), 400);
      if (parsed.kind === 'redirect_error') return c.redirect(parsed.url, 303);
      const r = parsed.request;
      const action = form.get('action');
      const ip = getClientIp(c.req.raw.headers);

      if (action === 'deny') {
        return redirectWith(c, r, { error: 'access_denied' });
      }

      if (action === 'unlock') {
        if (consentIpFailures.isLimited(ip) || consentGlobalFailures.isLimited('all')) {
          // Only a limiter that is actually tripped counts, or the global window would inflate the wait.
          const wait = Math.max(
            consentIpFailures.isLimited(ip) ? consentIpFailures.retryAfter(ip) : 0,
            consentGlobalFailures.isLimited('all') ? consentGlobalFailures.retryAfter('all') : 0,
          );
          contextLogger.warn('Consent form rate limited');
          return page(c, ratePage(r, wait), 429, { 'Retry-After': String(wait) });
        }
        if (!isConnectCode(form.get('connect_code') ?? '')) {
          consentIpFailures.hit(ip);
          consentGlobalFailures.hit('all');
          contextLogger.warn('Wrong connect code');
          return page(c, secretStepPage(r, 'wrong'), 401);
        }
        if (grantLimitReached()) return page(c, limitPage(r), 409);
        const list = memberList();
        if (list.length === 0) return page(c, noMembersPage(r), 409);
        return page(c, memberStepPage(r, createTicket(r), list));
      }

      if (action === 'approve') {
        if (!verifyTicket(form.get('ticket'), r)) return page(c, secretStepPage(r, 'expired'), 401);
        if (grantLimitReached()) return page(c, limitPage(r), 409);
        const memberId = Number(form.get('member_id'));
        const member = Number.isInteger(memberId)
          ? db.select({ id: members.id }).from(members).where(eq(members.id, memberId)).get()
          : undefined;
        if (!member) return page(c, memberStepPage(r, createTicket(r), memberList(), true), 400);
        const code = createGrant({
          clientId: r.clientId,
          memberId: member.id,
          redirectUri: r.redirectUri,
          codeChallenge: r.codeChallenge,
          resource: r.resource,
          scope: r.scope,
        });
        contextLogger.info({ clientId: r.clientId, memberId: member.id }, 'OAuth consent approved');
        return redirectWith(c, r, { code });
      }

      return page(c, invalidPage(), 400);
    } catch (err) {
      contextLogger.error({ err: err instanceof Error ? err.message : 'unknown' }, 'Consent failed');
      return page(c, failPage(), 500);
    }
  });
