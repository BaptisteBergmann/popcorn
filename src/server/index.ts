import { serve } from '@hono/node-server';
import { app } from '@server/app';
import { runMigrations } from '@server/db';
import { env } from '@server/env';
import { logger } from '@server/logger';

runMigrations();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.child({ function: 'serve' }).info({ port: info.port }, 'Popcorn listening');
});
