import { serve } from '@hono/node-server';
import { app } from '@server/app';
import { env } from '@server/env';
import { logger } from '@server/logger';

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.child({ function: 'serve' }).info({ port: info.port }, 'Popcorn listening');
});
