import { z } from 'zod';

const schema = z.object({
  // URL-safe charset on purpose: the token is injected into <base href> and compared as a path segment.
  APP_TOKEN: z
    .string()
    .min(16, 'APP_TOKEN must be at least 16 characters')
    .regex(/^[A-Za-z0-9_-]+$/, 'APP_TOKEN may only contain A-Z a-z 0-9 _ -'),
  // Consent secret for MCP sign-in. Optional: without it the app works and /oauth/authorize refuses.
  // Kept apart from APP_TOKEN so rotating one never touches the other. An empty value
  // (compose passes '' when the variable is unset) counts as unset.
  MCP_CONNECT_CODE: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(16, 'MCP_CONNECT_CODE must be at least 16 characters').optional(),
  ),
  TMDB_API_TOKEN: z.string().min(1),
  SITE_URL: z
    .url()
    .transform((v) => v.replace(/\/+$/, '')),
  DATABASE_PATH: z.string().min(1).default('/data/popcorn.db'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = schema
  .refine((v) => v.MCP_CONNECT_CODE === undefined || v.MCP_CONNECT_CODE !== v.APP_TOKEN, {
    // The two secrets guard different doors; sharing a value would let one leak open the other.
    path: ['MCP_CONNECT_CODE'],
    message: 'MCP_CONNECT_CODE must differ from APP_TOKEN',
  })
  .safeParse(process.env);
if (!parsed.success) {
  // Print field names and messages only, never the values.
  const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
  process.stderr.write(`Invalid environment:\n${problems}\n`);
  process.exit(1);
}

export const env = parsed.data;
