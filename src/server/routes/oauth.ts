import { randomUUID } from 'node:crypto';
import { count } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '@server/db';
import { OAUTH_AUTH_METHODS, oauthClients, type OAuthAuthMethod } from '@server/db/schema';
import { logger } from '@server/logger';
import { authenticateClient, generateClientSecret, sha256Hex } from '@server/oauth/clients';
import { OAUTH_SCOPE, MAX_CLIENTS, oauthUrls } from '@server/oauth/config';
import {
  isFormContentType,
  noStoreJson,
  oauthError,
  readCappedText,
  tooManyRequests,
} from '@server/oauth/http';
import { authorizationServerMetadata, protectedResourceMetadata } from '@server/oauth/metadata';
import { isAllowedRedirectUri } from '@server/oauth/redirect_uri';
import { issueTokensForCode, revokeGrantByToken, rotateRefreshToken, sweepOAuth } from '@server/oauth/tokens';
import type { TokenGrantResult } from '@server/oauth/tokens';
import {
  getClientIp,
  registerGlobalLimiter,
  registerIpLimiter,
  revokeIpLimiter,
  tokenFailureLimiter,
  tokenIpLimiter,
} from '@server/rate_limit';

// Public OAuth surface for MCP clients, mounted before the token gate. This is the fixed list in
// CLAUDE.md: anything else still falls through to the gate and gets a bare 404.

const MAX_CLIENT_NAME = 100;
const MAX_REDIRECT_URIS = 10;

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

export const oauth = new Hono()
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
      contextLogger.warn({ given: Array.isArray(uris) ? uris.length : 0 }, 'Registration rejected: redirect_uris');
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
  });
