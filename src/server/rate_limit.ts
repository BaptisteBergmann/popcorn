import { isIP } from 'node:net';

// In-memory fixed-window limiter. One container, so process memory is enough; a restart resets
// the counters. The map is bounded: expired entries are swept once it passes half of maxKeys,
// and the oldest are dropped past maxKeys.
export function createRateLimiter({
  windowMs,
  max,
  maxKeys = 10_000,
}: {
  windowMs: number;
  max: number;
  maxKeys?: number;
}) {
  const entries = new Map<string, { count: number; resetAt: number }>();

  function sweep(now: number) {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
    // Maps iterate in insertion order, so the first keys are the oldest.
    for (const key of entries.keys()) {
      if (entries.size <= maxKeys) break;
      entries.delete(key);
    }
  }

  return {
    /** Counts an attempt. Returns true when it is allowed. */
    hit(key: string): boolean {
      const now = Date.now();
      if (entries.size > maxKeys / 2) sweep(now);
      const entry = entries.get(key);
      if (!entry || entry.resetAt <= now) {
        entries.delete(key); // re-insert so the key becomes the newest
        entries.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      entry.count += 1;
      return entry.count <= max;
    },
    /** True when the key already used up its max in the current window. Doesn't count. */
    isLimited(key: string): boolean {
      const entry = entries.get(key);
      return !!entry && entry.resetAt > Date.now() && entry.count >= max;
    },
    /** Seconds until the key's window ends (0 when it has none). */
    retryAfter(key: string): number {
      const entry = entries.get(key);
      return entry && entry.resetAt > Date.now() ? Math.ceil((entry.resetAt - Date.now()) / 1000) : 0;
    },
    reset(key: string) {
      entries.delete(key);
    },
  };
}

/**
 * Only cf-connecting-ip is read (set by the Cloudflare Tunnel); x-forwarded-for is client-controlled.
 * The container port is also published on the host, so the header can be forged by anything that
 * reaches it directly: limiters keyed on it also get a global bucket.
 */
export function getClientIp(headers: Headers): string {
  const value = headers.get('cf-connecting-ip')?.trim();
  return value && isIP(value) !== 0 ? value : 'unknown';
}

// Consent form: failures only, success doesn't count.
export const consentIpFailures = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
export const consentGlobalFailures = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 20, maxKeys: 1 });

export const registerIpLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
export const registerGlobalLimiter = createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 50, maxKeys: 1 });

export const tokenIpLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 60 });
// Failed grants only (bad code, verifier, refresh token or client).
export const tokenFailureLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

export const revokeIpLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

// Only failures are counted, so a client with a valid token is never locked out by its own calls.
export const mcpFailedAuthLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
// Authenticated calls per grant id.
export const mcpCallLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 120 });
