import { z } from 'zod';

const schema = z.object({
  // URL-safe charset on purpose: the token is injected into <base href> and compared as a path segment.
  APP_TOKEN: z
    .string()
    .min(16, 'APP_TOKEN must be at least 16 characters')
    .regex(/^[A-Za-z0-9_-]+$/, 'APP_TOKEN may only contain A-Z a-z 0-9 _ -'),
  TMDB_API_TOKEN: z.string().min(1),
  SITE_URL: z
    .url()
    .transform((v) => v.replace(/\/+$/, '')),
  DATABASE_PATH: z.string().min(1).default('/data/popcorn.db'),
  MEMBERS: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().max(30)).min(1)),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Print field names and messages only, never the values.
  const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
  process.stderr.write(`Invalid environment:\n${problems}\n`);
  process.exit(1);
}

export const env = parsed.data;
