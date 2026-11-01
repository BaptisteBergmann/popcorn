import { logger } from '@server/logger';
import { findClient } from '@server/oauth/clients';
import { OAUTH_SCOPE, oauthUrls } from '@server/oauth/config';
import { CODE_CHALLENGE_RE } from '@server/oauth/pkce';
import { redirectDisplayHost, redirectUriMatches } from '@server/oauth/redirect_uri';

// Only echoed back to the client, never stored. Google sends long opaque values, so the cap only
// guards against absurd URLs.
const MAX_STATE_LENGTH = 4096;

export type AuthorizeRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  // Hostname shown on the consent page; null for loopback ("an app on this computer").
  redirectHost: string | null;
  state: string | null;
  codeChallenge: string;
  resource: string;
  scope: string;
};

export type AuthorizeParse =
  | { kind: 'ok'; request: AuthorizeRequest }
  // Never redirect: the client or redirect URI can't be trusted.
  | { kind: 'error_page'; reason: 'invalid_request' | 'unknown_client' | 'invalid_redirect_uri' }
  // The redirect URI is validated, so the error goes back to the client.
  | { kind: 'redirect_error'; url: string };

/** Query params for a redirect back to the client. `iss` is the RFC 9207 mix-up defence. */
export function buildClientRedirect(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  url.searchParams.set('iss', oauthUrls.issuer);
  return url.toString();
}

/** Shared by the consent page and every action, so actions never trust anything but validated params. */
export function parseAuthorizeRequest(params: URLSearchParams): AuthorizeParse {
  const result = parse(params);
  if (result.kind !== 'ok') {
    // Third-party clients only ever see a generic error, so log why. No state or challenge
    // values, only lengths; param names only when they look like names.
    logger.child({ function: 'parseAuthorizeRequest' }).warn(
      {
        reason: result.kind === 'error_page' ? result.reason : new URL(result.url).searchParams.get('error'),
        paramKeys: [...new Set(params.keys())].slice(0, 30).map((k) => (/^[a-z_]{1,40}$/i.test(k) ? k : '<invalid>')),
        // Attacker-controlled: log only values we recognise.
        responseType: params.get('response_type') === 'code' ? 'code' : null,
        codeChallengeMethod: params.get('code_challenge_method') === 'S256' ? 'S256' : null,
        codeChallengeLength: params.get('code_challenge')?.length ?? null,
        stateLength: params.get('state')?.length ?? null,
      },
      'OAuth authorize request rejected',
    );
  }
  return result;
}

function parse(params: URLSearchParams): AuthorizeParse {
  // A repeated parameter is ambiguous: refuse rather than pick one.
  for (const key of new Set(params.keys())) {
    if (params.getAll(key).length > 1) return { kind: 'error_page', reason: 'invalid_request' };
  }

  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  if (!clientId || !redirectUri) return { kind: 'error_page', reason: 'invalid_request' };

  const client = findClient(clientId);
  if (!client) return { kind: 'error_page', reason: 'unknown_client' };
  if (!redirectUriMatches(client.redirectUris, redirectUri)) {
    return { kind: 'error_page', reason: 'invalid_redirect_uri' };
  }

  const state = params.get('state');
  const fail = (error: string) => ({
    kind: 'redirect_error' as const,
    url: buildClientRedirect(redirectUri, {
      error,
      state: state && state.length <= MAX_STATE_LENGTH ? state : null,
    }),
  });

  if (state !== null && state.length > MAX_STATE_LENGTH) return fail('invalid_request');
  if (params.get('response_type') !== 'code') return fail('unsupported_response_type');

  const codeChallenge = params.get('code_challenge');
  if (!codeChallenge || !CODE_CHALLENGE_RE.test(codeChallenge) || params.get('code_challenge_method') !== 'S256') {
    return fail('invalid_request');
  }

  // The requested scope is ignored: every grant gets OAUTH_SCOPE, and the token response says so
  // (RFC 6749 section 3.3). Clients ask for extras like offline_access, and refusing would break them.
  const resource = params.get('resource');
  if (resource && resource !== oauthUrls.mcpResource) return fail('invalid_target');

  return {
    kind: 'ok',
    request: {
      clientId: client.id,
      clientName: client.clientName,
      redirectUri,
      redirectHost: redirectDisplayHost(redirectUri),
      state,
      codeChallenge,
      resource: oauthUrls.mcpResource,
      scope: OAUTH_SCOPE,
    },
  };
}
