const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// Only these may receive an authorization code over https. Open registration would otherwise let a
// phishing link send a real consent page's code anywhere. Add a host only for a client in use.
const ALLOWED_HTTPS_HOSTS = new Set(['claude.ai', 'claude.com']);
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000- \u007F]/;

export const MAX_REDIRECT_URI_LENGTH = 500;

export const isLoopbackHost = (hostname: string) => LOOPBACK_HOSTS.has(hostname);

// `http` on a loopback host or `https` on an allowlisted host (RFC 8252), no fragment, userinfo
// or custom scheme.
export function isAllowedRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > MAX_REDIRECT_URI_LENGTH) return false;
  if (FORBIDDEN_CHARS.test(uri)) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || uri.includes('#')) return false;
  if (url.username || url.password) return false;
  // Default port only: a host allowlist alone would still accept claude.ai:8443.
  if (url.protocol === 'https:') return url.port === '' && ALLOWED_HTTPS_HOSTS.has(url.hostname);
  return url.protocol === 'http:' && isLoopbackHost(url.hostname);
}

// Exact match; the one exception (RFC 8252 section 7.3) is that a loopback redirect may use a
// different port than the registered one.
export function redirectUriMatches(registered: readonly string[], requested: string): boolean {
  if (!isAllowedRedirectUri(requested)) return false;
  if (registered.includes(requested)) return true;

  const req = new URL(requested);
  if (req.protocol !== 'http:' || !isLoopbackHost(req.hostname)) return false;

  return registered.some((candidate) => {
    let reg: URL;
    try {
      reg = new URL(candidate);
    } catch {
      return false;
    }
    return (
      reg.protocol === 'http:' &&
      isLoopbackHost(reg.hostname) &&
      reg.hostname === req.hostname &&
      reg.pathname === req.pathname &&
      reg.search === req.search
    );
  });
}

/** Host shown on the consent page. Loopback returns null: the port and path mean nothing to people. */
export function redirectDisplayHost(uri: string): string | null {
  const url = new URL(uri);
  return isLoopbackHost(url.hostname) ? null : url.host;
}
