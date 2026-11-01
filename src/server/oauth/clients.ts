import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@server/db';
import { oauthClients } from '@server/db/schema';
import { CLIENT_SECRET_PREFIX } from '@server/oauth/config';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OAuthClient = Omit<typeof oauthClients.$inferSelect, 'redirectUris'> & {
  redirectUris: string[];
};

export const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export const generateClientSecret = () => CLIENT_SECRET_PREFIX + randomBytes(32).toString('base64url');

export function findClient(clientId: unknown): OAuthClient | null {
  if (typeof clientId !== 'string' || !UUID_RE.test(clientId)) return null;
  const row = db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).get();
  if (!row) return null;
  let redirectUris: string[] = [];
  try {
    const v: unknown = JSON.parse(row.redirectUris);
    if (Array.isArray(v)) redirectUris = v.filter((u): u is string => typeof u === 'string');
  } catch {
    // A corrupt row has no usable redirect, so it can never authorize anything.
  }
  return { ...row, redirectUris };
}

export type ClientAuth =
  | { status: 'ok'; client: OAuthClient }
  // `why` is for logs only (an enum, never a value); clients only ever see invalid_client.
  | { status: 'invalid_client'; why: string };

function parseBasic(header: string | null): { id: string; secret: string } | null {
  const match = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(header ?? '');
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1]!, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    // RFC 6749 section 2.3.1: both parts are form-urlencoded before base64.
    return {
      id: decodeURIComponent(decoded.slice(0, idx)),
      secret: decodeURIComponent(decoded.slice(idx + 1)),
    };
  } catch {
    return null;
  }
}

// Identifies and authenticates the client of a token/revoke request. Public clients (method none)
// must not send a secret; confidential ones must send the right one, in the body or Basic header.
export function authenticateClient(headers: Headers, body: URLSearchParams): ClientAuth {
  const basic = parseBasic(headers.get('authorization'));
  const bodyId = body.get('client_id');
  const clientId = basic?.id ?? bodyId;
  if (basic && bodyId && bodyId !== basic.id) {
    return { status: 'invalid_client', why: 'basic_body_id_conflict' };
  }
  const secret = basic?.secret ?? body.get('client_secret');

  const client = findClient(clientId);
  if (!client) return { status: 'invalid_client', why: clientId ? 'client_not_found' : 'no_client_id' };

  if (client.authMethod === 'none') {
    return secret ? { status: 'invalid_client', why: 'secret_sent_by_public_client' } : { status: 'ok', client };
  }

  if (!secret || !client.clientSecretHash) return { status: 'invalid_client', why: 'no_secret' };
  const given = Buffer.from(sha256Hex(secret));
  const stored = Buffer.from(client.clientSecretHash);
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    return { status: 'invalid_client', why: 'secret_mismatch' };
  }
  return { status: 'ok', client };
}
