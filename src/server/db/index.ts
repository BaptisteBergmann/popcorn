import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { env } from '@server/env';
import { logger } from '@server/logger';
import * as schema from '@server/db/schema';

mkdirSync(path.dirname(env.DATABASE_PATH), { recursive: true });

const sqlite = new Database(env.DATABASE_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

/** Applies generated migrations. Safe at startup: single container, single writer. */
export function runMigrations() {
  migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  logger.child({ function: 'runMigrations' }).info('Migrations applied');
}
