import { createHash } from 'node:crypto';
import { env } from '@server/env';

// Every URL we advertise or compare against comes from SITE_URL, never from request headers
// (Host / X-Forwarded-* are client-controlled).
export const OAUTH_SCOPE = 'mcp';

export const CODE_PREFIX = 'pcc_';
export const ACCESS_TOKEN_PREFIX = 'pca_';
export const REFRESH_TOKEN_PREFIX = 'pcr_';
export const CLIENT_SECRET_PREFIX = 'pcs_';

export const CODE_TTL_MS = 2 * 60 * 1000;
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
// Sliding window renewed on every refresh, bounded by an absolute cap per grant.
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const GRANT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const CONSENT_TICKET_TTL_MS = 10 * 60 * 1000;

export const MAX_ACTIVE_GRANTS = 20;
export const MAX_CLIENTS = 100;

const issuer = new URL(env.SITE_URL).origin;

export const oauthUrls = {
  issuer,
  mcpResource: `${issuer}/mcp`,
  prmUrl: `${issuer}/.well-known/oauth-protected-resource/mcp`,
} as const;

/** Tag stored on each grant. Rotating MCP_CONNECT_CODE changes it and so disconnects every grant. */
export const currentConnectCodeTag: string | null = env.MCP_CONNECT_CODE
  ? createHash('sha256').update(`popcorn-grant|${env.MCP_CONNECT_CODE}`).digest('hex')
  : null;
