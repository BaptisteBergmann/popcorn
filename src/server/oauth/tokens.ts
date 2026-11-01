import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@server/db';
import { members, oauthClients, oauthGrants } from '@server/db/schema';
import { logger } from '@server/logger';
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_MS,
  CODE_PREFIX,
  CODE_TTL_MS,
  GRANT_MAX_AGE_MS,
  MAX_ACTIVE_GRANTS,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_MS,
  currentConnectCodeTag,
  oauthUrls,
} from '@server/oauth/config';
import { sha256Hex } from '@server/oauth/clients';
import { verifyS256 } from '@server/oauth/pkce';

// Not worth a write on every call; "last used" only needs to be roughly right.
const LAST_USED_REFRESH_MS = 5 * 60 * 1000;
const STALE_CLIENT_MS = 24 * 60 * 60 * 1000;

const random43 = () => randomBytes(32).toString('base64url');
export const generateAuthCode = () => CODE_PREFIX + random43();
const generateAccessToken = () => ACCESS_TOKEN_PREFIX + random43();
const generateRefreshToken = () => REFRESH_TOKEN_PREFIX + random43();
export const hashToken = sha256Hex;

const plausible = (prefix: string) => new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`);
const CODE_RE = plausible(CODE_PREFIX);
const ACCESS_RE = plausible(ACCESS_TOKEN_PREFIX);
const REFRESH_RE = plausible(REFRESH_TOKEN_PREFIX);
export const isPlausibleAccessToken = (t: string) => ACCESS_RE.test(t);

export type TokenGrantResult =
  | { status: 'ok'; accessToken: string; refreshToken: string; expiresIn: number; scope: string }
  // `why` is for logs only (an enum, never a value); clients only ever see invalid_grant.
  | { status: 'invalid_grant'; why?: string };

type GrantRow = typeof oauthGrants.$inferSelect;

// Fresh pair for a grant. The refresh window slides but never passes the absolute cap; the access
// token never outlives the refresh window either.
function newTokenPair(grantCreatedAt: number) {
  const now = Date.now();
  const refreshExpiresMs = Math.min(now + REFRESH_TOKEN_TTL_MS, grantCreatedAt + GRANT_MAX_AGE_MS);
  const accessExpiresMs = Math.min(now + ACCESS_TOKEN_TTL_MS, refreshExpiresMs);
  const accessToken = generateAccessToken();
  const refreshToken = generateRefreshToken();
  return {
    accessToken,
    refreshToken,
    expiresIn: Math.max(0, Math.floor((accessExpiresMs - now) / 1000)),
    columns: {
      accessTokenHash: hashToken(accessToken),
      accessExpiresAt: accessExpiresMs,
      refreshTokenHash: hashToken(refreshToken),
      refreshExpiresAt: refreshExpiresMs,
    },
  };
}

export function revokeGrantById(grantId: string, reason: string): void {
  db.update(oauthGrants)
    .set({ revokedAt: Date.now() })
    .where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt)))
    .run();
  logger.child({ function: 'revokeGrantById', grantId }).warn({ reason }, 'OAuth grant revoked');
}

/**
 * Condition for a live connection: current connect code, not revoked, and either a code still
 * waiting to be exchanged or a refresh token still valid. Null when MCP sign-in is disabled.
 * The connection limit and the connections list share it, so they always agree.
 */
export function liveGrantCondition(): SQL | null {
  if (!currentConnectCodeTag) return null;
  const now = Date.now();
  return and(
    eq(oauthGrants.connectCodeTag, currentConnectCodeTag),
    isNull(oauthGrants.revokedAt),
    or(
      and(isNull(oauthGrants.codeUsedAt), gt(oauthGrants.codeExpiresAt, now)),
      gt(oauthGrants.refreshExpiresAt, now),
    ),
  ) ?? null;
}

export function countActiveGrants(): number {
  const live = liveGrantCondition();
  if (!live) return 0;
  const row = db.select({ n: sql<number>`count(*)` }).from(oauthGrants).where(live).get();
  return row?.n ?? 0;
}

export const grantLimitReached = () => countActiveGrants() >= MAX_ACTIVE_GRANTS;

/** Inserts a grant after consent and returns the one-time authorization code. */
export function createGrant(params: {
  clientId: string;
  memberId: number;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
}): string {
  if (!currentConnectCodeTag) throw new Error('MCP_CONNECT_CODE is not set');
  const code = generateAuthCode();
  const now = Date.now();
  db.insert(oauthGrants)
    .values({
      id: randomUUID(),
      ...params,
      codeHash: hashToken(code),
      codeExpiresAt: now + CODE_TTL_MS,
      connectCodeTag: currentConnectCodeTag,
      createdAt: now,
    })
    .run();
  sweepOAuth();
  return code;
}

// No cron: expired rows are swept on each registration and approval.
export function sweepOAuth(): void {
  const now = Date.now();
  db.delete(oauthGrants)
    .where(
      or(
        isNotNull(oauthGrants.revokedAt),
        and(isNull(oauthGrants.codeUsedAt), lt(oauthGrants.codeExpiresAt, now)),
        lt(oauthGrants.refreshExpiresAt, now),
      ),
    )
    .run();
  const used = db.selectDistinct({ id: oauthGrants.clientId }).from(oauthGrants);
  db.delete(oauthClients)
    .where(and(lt(oauthClients.createdAt, now - STALE_CLIENT_MS), notInArray(oauthClients.id, used)))
    .run();
}

export function issueTokensForCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string | null;
}): TokenGrantResult {
  if (!CODE_RE.test(params.code)) return { status: 'invalid_grant', why: 'code_implausible' };
  const contextLogger = logger.child({ function: 'issueTokensForCode', clientId: params.clientId });

  const grant = db
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.codeHash, hashToken(params.code)))
    .get();
  if (!grant) return { status: 'invalid_grant', why: 'code_not_found' };

  // Replay of a code that was already exchanged: whatever it issued is suspect.
  if (grant.codeUsedAt) {
    revokeGrantById(grant.id, 'authorization code reused');
    return { status: 'invalid_grant', why: 'code_reused' };
  }
  if (grant.revokedAt) return { status: 'invalid_grant', why: 'grant_revoked' };
  if (grant.codeExpiresAt <= Date.now()) return { status: 'invalid_grant', why: 'code_expired' };
  // Same liveness rules as refresh and /mcp: a rotated code or a removed member kills the grant.
  if (grant.connectCodeTag !== currentConnectCodeTag) return { status: 'invalid_grant', why: 'connect_code_changed' };
  if (!memberExists(grant.memberId)) return { status: 'invalid_grant', why: 'member_gone' };
  if (grant.clientId !== params.clientId) return { status: 'invalid_grant', why: 'client_mismatch' };
  if (grant.redirectUri !== params.redirectUri) return { status: 'invalid_grant', why: 'redirect_uri_mismatch' };
  if (params.resource !== null && params.resource !== grant.resource) {
    return { status: 'invalid_grant', why: 'resource_mismatch' };
  }
  if (!verifyS256(params.codeVerifier, grant.codeChallenge)) {
    return { status: 'invalid_grant', why: 'pkce_mismatch' };
  }

  const pair = newTokenPair(grant.createdAt);
  const now = Date.now();
  const updated = db
    .update(oauthGrants)
    .set({ ...pair.columns, codeUsedAt: now })
    .where(
      and(
        eq(oauthGrants.id, grant.id),
        isNull(oauthGrants.codeUsedAt),
        isNull(oauthGrants.revokedAt),
        gt(oauthGrants.codeExpiresAt, now),
      ),
    )
    .returning({ id: oauthGrants.id })
    .get();
  if (!updated) {
    // Lost a race against another exchange of the same code.
    revokeGrantById(grant.id, 'authorization code raced');
    return { status: 'invalid_grant', why: 'code_raced' };
  }

  contextLogger.info({ grantId: grant.id }, 'OAuth tokens issued');
  return {
    status: 'ok',
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresIn: pair.expiresIn,
    scope: grant.scope,
  };
}

export function rotateRefreshToken(params: { refreshToken: string; clientId: string }): TokenGrantResult {
  if (!REFRESH_RE.test(params.refreshToken)) return { status: 'invalid_grant', why: 'refresh_implausible' };
  const contextLogger = logger.child({ function: 'rotateRefreshToken', clientId: params.clientId });
  const oldHash = hashToken(params.refreshToken);

  const grant = db.select().from(oauthGrants).where(eq(oauthGrants.refreshTokenHash, oldHash)).get();

  if (!grant) {
    // An already-rotated token coming back means two parties hold it: kill the grant. Only the
    // previous token is remembered; older ones are plain invalid_grant.
    const reused = db
      .select({ id: oauthGrants.id })
      .from(oauthGrants)
      .where(eq(oauthGrants.previousRefreshTokenHash, oldHash))
      .get();
    if (reused) revokeGrantById(reused.id, 'refresh token reused');
    return { status: 'invalid_grant', why: reused ? 'refresh_reused' : 'refresh_not_found' };
  }

  if (
    grant.revokedAt ||
    grant.clientId !== params.clientId ||
    !grant.refreshExpiresAt ||
    grant.refreshExpiresAt <= Date.now() ||
    grant.connectCodeTag !== currentConnectCodeTag ||
    // Same join as /mcp: a grant whose member is gone is dead even with foreign keys off.
    !memberExists(grant.memberId)
  ) {
    return { status: 'invalid_grant', why: 'grant_unusable' };
  }

  const pair = newTokenPair(grant.createdAt);
  const updated = db
    .update(oauthGrants)
    .set({ ...pair.columns, previousRefreshTokenHash: oldHash })
    .where(
      and(
        eq(oauthGrants.id, grant.id),
        eq(oauthGrants.refreshTokenHash, oldHash),
        isNull(oauthGrants.revokedAt),
      ),
    )
    .returning({ id: oauthGrants.id })
    .get();
  if (!updated) return { status: 'invalid_grant', why: 'refresh_raced' };

  contextLogger.info({ grantId: grant.id }, 'OAuth refresh token rotated');
  return {
    status: 'ok',
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresIn: pair.expiresIn,
    scope: grant.scope,
  };
}

const memberExists = (id: number) =>
  db.select({ id: members.id }).from(members).where(eq(members.id, id)).get() !== undefined;

export type ResolvedGrant = { grantId: string; memberId: number; memberName: string };

/** Resolves a bearer token to its grant and member, or null for anything invalid. */
export function resolveAccessToken(token: string): ResolvedGrant | null {
  if (!ACCESS_RE.test(token) || !currentConnectCodeTag) return null;

  // Inner join: a grant whose member row is gone fails here even if the cascade didn't run.
  const row = db
    .select({
      grant: oauthGrants,
      memberName: members.name,
    })
    .from(oauthGrants)
    .innerJoin(members, eq(members.id, oauthGrants.memberId))
    .where(and(eq(oauthGrants.accessTokenHash, hashToken(token)), isNull(oauthGrants.revokedAt)))
    .get();
  if (!row) return null;
  const g: GrantRow = row.grant;
  const now = Date.now();
  if (!g.accessExpiresAt || g.accessExpiresAt <= now) return null;
  if (g.resource !== oauthUrls.mcpResource) return null;
  if (g.connectCodeTag !== currentConnectCodeTag) return null;

  if (now - (g.lastUsedAt ?? 0) > LAST_USED_REFRESH_MS) {
    db.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, g.id)).run();
  }
  return { grantId: g.id, memberId: g.memberId, memberName: row.memberName };
}

/**
 * RFC 7009: accepts an access or refresh token and revokes the whole grant, only when it belongs
 * to the authenticated client. Unknown tokens are not an error.
 */
export function revokeGrantByToken(token: string, clientId: string): void {
  const column = ACCESS_RE.test(token)
    ? oauthGrants.accessTokenHash
    : REFRESH_RE.test(token)
      ? oauthGrants.refreshTokenHash
      : null;
  if (!column) return;
  const hash = hashToken(token);
  const rows = db
    .select({ id: oauthGrants.id })
    .from(oauthGrants)
    .where(and(eq(column, hash), eq(oauthGrants.clientId, clientId), isNull(oauthGrants.revokedAt)))
    .all();
  if (rows.length) {
    db.update(oauthGrants)
      .set({ revokedAt: Date.now() })
      .where(inArray(oauthGrants.id, rows.map((r) => r.id)))
      .run();
    logger.child({ function: 'revokeGrantByToken', clientId }).info('OAuth grant revoked by client');
  }
}
