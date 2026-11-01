import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
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

export const OAUTH_AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'] as const;
export type OAuthAuthMethod = (typeof OAUTH_AUTH_METHODS)[number];

// Dynamically registered MCP clients. A row grants nothing until someone consents.
export const oauthClients = sqliteTable('oauth_clients', {
  id: text('id').primaryKey(),
  clientName: text('client_name').notNull(),
  // JSON array of validated redirect URIs.
  redirectUris: text('redirect_uris').notNull(),
  authMethod: text('auth_method', { enum: OAUTH_AUTH_METHODS }).notNull(),
  clientSecretHash: text('client_secret_hash'),
  createdAt: integer('created_at').notNull(),
});

// One row per MCP connection: code, access and refresh token live here, hashed only.
export const oauthGrants = sqliteTable(
  'oauth_grants',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id, { onDelete: 'cascade' }),
    // Cascade: removing a member drops their connections.
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    resource: text('resource').notNull(),
    scope: text('scope').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeHash: text('code_hash').notNull(),
    codeExpiresAt: integer('code_expires_at').notNull(),
    codeUsedAt: integer('code_used_at'),
    accessTokenHash: text('access_token_hash'),
    accessExpiresAt: integer('access_expires_at'),
    refreshTokenHash: text('refresh_token_hash'),
    previousRefreshTokenHash: text('previous_refresh_token_hash'),
    refreshExpiresAt: integer('refresh_expires_at'),
    // sha256 of MCP_CONNECT_CODE at consent: rotating the code disconnects every grant.
    connectCodeTag: text('connect_code_tag').notNull(),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
  },
  (t) => [
    uniqueIndex('oauth_grants_code_hash_unique').on(t.codeHash),
    uniqueIndex('oauth_grants_access_token_hash_unique').on(t.accessTokenHash),
    uniqueIndex('oauth_grants_refresh_token_hash_unique').on(t.refreshTokenHash),
    index('oauth_grants_previous_refresh_token_hash_idx').on(t.previousRefreshTokenHash),
    index('oauth_grants_client_id_idx').on(t.clientId),
    index('oauth_grants_member_id_idx').on(t.memberId),
  ],
);
