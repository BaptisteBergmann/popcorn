import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
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
  const contextLogger = logger.child({ function: 'runMigrations' });
  migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  contextLogger.info('Migrations applied');
  rekeyMembers();
}

/**
 * Recomputes `members.name_key` with `memberKey()`. The SQL backfill in migration 0002
 * used ASCII-only lower(), so non-ASCII names could carry a wrong key. Idempotent.
 */
function rekeyMembers() {
  const contextLogger = logger.child({ function: 'rekeyMembers' });
  const rows = db.select({ id: schema.members.id, name: schema.members.name, nameKey: schema.members.nameKey }).from(schema.members).all();
  for (const row of rows) {
    const key = schema.memberKey(row.name);
    if (key === row.nameKey) continue;
    try {
      db.update(schema.members).set({ nameKey: key }).where(eq(schema.members.id, row.id)).run();
      contextLogger.info({ memberId: row.id }, 'Member key recomputed');
    } catch (err) {
      if ((err as { code?: string }).code !== 'SQLITE_CONSTRAINT_UNIQUE') throw err;
      // Two legacy rows that now fold to the same key: keep both, flag it.
      contextLogger.warn({ memberId: row.id, err }, 'Member key collides with another member');
    }
  }
}
