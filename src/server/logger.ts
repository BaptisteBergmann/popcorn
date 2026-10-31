import pino from 'pino';
import { env } from '@server/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: ['TMDB_API_TOKEN', 'APP_TOKEN', '*.authorization', '*.token'],
});
