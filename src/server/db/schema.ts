import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
// Relative path on purpose: drizzle-kit loads this file without tsconfig path aliases.
import { TITLE_STATUSES, TITLE_TYPES } from '../../shared/constants';

export const titles = sqliteTable(
  'titles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tmdbId: integer('tmdb_id').notNull(),
    type: text('type', { enum: TITLE_TYPES }).notNull(),
    imdbId: text('imdb_id'),
    title: text('title').notNull(),
    year: integer('year'),
    posterPath: text('poster_path'),
    overview: text('overview'),
    // JSON array of genre names, stored at add time.
    genres: text('genres').notNull().default('[]'),
    runtime: integer('runtime'),
    addedBy: text('added_by'),
    status: text('status', { enum: TITLE_STATUSES }).notNull().default('to_watch'),
    addedAt: integer('added_at').notNull(),
    watchedAt: integer('watched_at'),
    // Surprise: visible only to the adder in the web app and only in the Stremio random catalog.
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [uniqueIndex('titles_tmdb_id_type_unique').on(t.tmdbId, t.type)],
);

export type TitleRow = typeof titles.$inferSelect;
export type NewTitleRow = typeof titles.$inferInsert;

export { memberKey } from '../../shared/member_key';

export const members = sqliteTable(
  'members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('members_name_key_unique').on(t.nameKey)],
);
