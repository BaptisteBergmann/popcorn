import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@server/env';
import { CONSENT_TICKET_TTL_MS } from '@server/oauth/config';
import type { AuthorizeRequest } from '@server/oauth/authorize_request';

// Stateless proof that the connect code was entered for this exact request. It needs no session
// or storage, and it can't be moved to another client, redirect or challenge.
const sign = (exp: number, r: AuthorizeRequest): string => {
  const key = env.MCP_CONNECT_CODE;
  if (!key) throw new Error('MCP_CONNECT_CODE is not set');
  return createHmac('sha256', key)
    .update(['consent', exp, r.clientId, r.redirectUri, r.codeChallenge, r.resource].join('|'))
    .digest('hex');
};

export function createTicket(r: AuthorizeRequest): string {
  const exp = Date.now() + CONSENT_TICKET_TTL_MS;
  return `${exp}.${sign(exp, r)}`;
}

export function verifyTicket(ticket: string | null, r: AuthorizeRequest): boolean {
  const match = /^(\d{1,15})\.([0-9a-f]{64})$/.exec(ticket ?? '');
  if (!match) return false;
  const exp = Number(match[1]);
  if (exp <= Date.now()) return false;
  const given = Buffer.from(match[2]!);
  const expected = Buffer.from(sign(exp, r));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
