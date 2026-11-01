import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// No CORS on purpose: the clients that call these endpoints are servers or CLIs, and CORS stays
// Stremio-only.
export const MAX_BODY_BYTES = 8 * 1024;

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' } as const;

export function oauthError(
  c: Context,
  error: string,
  description?: string,
  status: ContentfulStatusCode = 400,
  headers: Record<string, string> = {},
) {
  return c.json(description ? { error, error_description: description } : { error }, status, {
    ...NO_STORE,
    ...headers,
  });
}

export const tooManyRequests = (c: Context, retryAfterSeconds: number) =>
  oauthError(c, 'too_many_requests', undefined, 429, { 'Retry-After': String(retryAfterSeconds) });

export const noStoreJson = (c: Context, body: object, status: ContentfulStatusCode = 200) =>
  c.json(body, status, NO_STORE);

/**
 * Reads the body as text but stops once the cap is exceeded, so a missing or lying Content-Length
 * can't make us buffer an arbitrarily large payload. Returns null when over the cap.
 */
export async function readCappedText(request: Request, maxBytes = MAX_BODY_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export const isFormContentType = (c: Context) =>
  (c.req.header('content-type') ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded');
