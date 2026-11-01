import { and, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { TitleStatus, TitleType } from '@shared/constants';
import { db } from '@server/db';
import { memberKey, members, titles, type TitleRow } from '@server/db/schema';
import { logger } from '@server/logger';
import { getDetails, posterUrl, searchMulti, TmdbError } from '@server/tmdb';

// Logic shared by the REST routes and the MCP tools, so both enforce the same rules.

export const memberName = z.string().trim().min(1).max(30);
export const titleId = z.number().int().positive();

export type WatchlistError =
  | 'unknown_member'
  | 'tmdb_not_found'
  | 'tmdb_unreachable'
  | 'already_in_list'
  | 'no_imdb_id'
  | 'not_found';

export type Result<T> = { ok: true; value: T } | { ok: false; code: WatchlistError };

const fail = (code: WatchlistError): { ok: false; code: WatchlistError } => ({ ok: false, code });

/** `visible` hides surprises from by-id lookups; REST keeps its historical `all`. */
export type Scope = 'all' | 'visible';

export const parseGenres = (raw: string): string[] => {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
};

export function toDto(row: TitleRow) {
  return {
    id: row.id,
    tmdbId: row.tmdbId,
    type: row.type,
    imdbId: row.imdbId,
    hasImdb: row.imdbId !== null,
    title: row.title,
    year: row.year,
    posterUrl: posterUrl(row.posterPath),
    overview: row.overview,
    genres: parseGenres(row.genres),
    runtime: row.runtime,
    addedBy: row.addedBy,
    status: row.status,
    addedAt: row.addedAt,
    watchedAt: row.watchedAt,
    hidden: row.hidden,
  };
}

export type TitleDto = ReturnType<typeof toDto>;

export function listTitles(opts: {
  status?: TitleStatus;
  type?: TitleType;
  member?: string;
}): TitleDto[] {
  // Soft visibility: surprises only show up for the member who added them.
  const visible = opts.member
    ? or(eq(titles.hidden, false), eq(titles.addedBy, opts.member))
    : eq(titles.hidden, false);
  const conditions: SQL[] = [];
  if (opts.status) conditions.push(eq(titles.status, opts.status));
  if (opts.type) conditions.push(eq(titles.type, opts.type));
  if (visible) conditions.push(visible);
  const rows = db
    .select()
    .from(titles)
    .where(and(...conditions))
    .orderBy(desc(titles.addedAt), desc(titles.id))
    .all();
  return rows.map(toDto);
}

export async function addTitle(input: {
  tmdbId: number;
  type: TitleType;
  addedBy: string;
  hidden: boolean;
}): Promise<Result<{ title: TitleDto; created: boolean }>> {
  const { tmdbId, type, addedBy, hidden } = input;
  const contextLogger = logger.child({ function: 'addTitle', tmdbId, type });

  const member = db
    .select({ name: members.name })
    .from(members)
    .where(eq(members.nameKey, memberKey(addedBy)))
    .get();
  if (!member) return fail('unknown_member');

  // Someone else picked a title that another member hid: defuse the surprise
  // rather than spoil it with a conflict or leave them with a title that never shows.
  const defuse = (): Result<{ title: TitleDto; created: boolean }> | null => {
    const exists = db
      .select({ id: titles.id, hidden: titles.hidden, addedBy: titles.addedBy })
      .from(titles)
      .where(and(eq(titles.tmdbId, tmdbId), eq(titles.type, type)))
      .get();
    if (!exists) return null;
    if (exists.hidden && exists.addedBy !== member.name) {
      const revealed = db
        .update(titles)
        .set({ hidden: false })
        .where(eq(titles.id, exists.id))
        .returning()
        .get();
      if (revealed) {
        contextLogger.info({ id: exists.id }, 'Surprise defused');
        return { ok: true, value: { title: toDto(revealed), created: false } };
      }
    }
    return fail('already_in_list');
  };
  const existing = defuse();
  if (existing) return existing;

  let details;
  try {
    details = await getDetails(type, tmdbId);
  } catch (err) {
    if (err instanceof TmdbError && err.status === 404) return fail('tmdb_not_found');
    contextLogger.error({ err: err instanceof Error ? err.message : 'unknown' }, 'Details fetch failed');
    return fail('tmdb_unreachable');
  }

  // A surprise that can't reach Stremio could never come up in random.
  if (hidden && details.imdbId === null) return fail('no_imdb_id');

  // The unique index also guards the race between the check above and this insert.
  const inserted = db
    .insert(titles)
    .values({ ...details, addedBy: member.name, addedAt: Date.now(), hidden })
    .onConflictDoNothing()
    .returning()
    .get();
  // Lost the race: a concurrent insert (possibly a hidden one by another member) won.
  if (!inserted) return defuse() ?? fail('already_in_list');

  contextLogger.info('Title added');
  return { ok: true, value: { title: toDto(inserted), created: true } };
}

const byId = (id: number, scope: Scope) =>
  scope === 'visible' ? and(eq(titles.id, id), eq(titles.hidden, false)) : eq(titles.id, id);

export function setTitleStatus(id: number, status: TitleStatus, scope: Scope): Result<TitleDto> {
  const updated = db
    .update(titles)
    // Watched reveals a surprise; unmarking never re-hides it.
    .set({
      status,
      watchedAt: status === 'watched' ? Date.now() : null,
      ...(status === 'watched' ? { hidden: false } : {}),
    })
    .where(byId(id, scope))
    .returning()
    .get();
  if (!updated) return fail('not_found');
  logger.child({ function: 'setStatus', id, status }).info('Status changed');
  return { ok: true, value: toDto(updated) };
}

export function removeTitle(id: number, scope: Scope): Result<void> {
  const deleted = db.delete(titles).where(byId(id, scope)).returning({ id: titles.id }).get();
  if (!deleted) return fail('not_found');
  logger.child({ function: 'removeTitle', id }).info('Title removed');
  return { ok: true, value: undefined };
}

export type SearchResult = {
  tmdbId: number;
  type: TitleType;
  title: string;
  year: number | null;
  posterUrl: string | null;
  inList: boolean;
};

export async function searchTitles(q: string, member?: string): Promise<Result<SearchResult[]>> {
  let hits;
  try {
    hits = await searchMulti(q);
  } catch (err) {
    logger
      .child({ function: 'search' })
      .error({ err: err instanceof Error ? err.message : 'unknown' }, 'Search failed');
    return fail('tmdb_unreachable');
  }
  hits = hits.slice(0, 20);

  const saved = hits.length
    ? db
        .select({
          tmdbId: titles.tmdbId,
          type: titles.type,
          hidden: titles.hidden,
          addedBy: titles.addedBy,
        })
        .from(titles)
        .where(
          inArray(
            titles.tmdbId,
            hits.map((h) => h.tmdbId),
          ),
        )
        .all()
    : [];
  const inList = new Set(
    saved.filter((s) => !s.hidden || s.addedBy === member).map((s) => `${s.type}:${s.tmdbId}`),
  );

  return {
    ok: true,
    value: hits.map((h) => ({
      tmdbId: h.tmdbId,
      type: h.type,
      title: h.title,
      year: h.year,
      posterUrl: posterUrl(h.posterPath),
      inList: inList.has(`${h.type}:${h.tmdbId}`),
    })),
  };
}
