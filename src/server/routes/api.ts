import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { TITLE_STATUSES, TITLE_TYPES } from '@shared/constants';
import { db } from '@server/db';
import { memberKey, members, titles, type TitleRow } from '@server/db/schema';
import { env } from '@server/env';
import { logger } from '@server/logger';
import { getDetails, posterUrl, searchMulti, TmdbError } from '@server/tmdb';

// Small `{ error }` body instead of the validator's default payload.
const onInvalid = (result: { success: boolean }, c: Context) => {
  if (!result.success) return c.json({ error: 'Invalid input' }, 400);
};

const parseGenres = (raw: string): string[] => {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
};

function toDto(row: TitleRow) {
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
  };
}

const memberName = z.string().trim().min(1).max(30);
const idParam = z.object({ id: z.coerce.number().int().positive() });

export const api = new Hono()
  .get('/config', (c) => {
    const token = c.req.param('token');
    return c.json({
      stremioManifestUrl: `${env.SITE_URL}/${token}/stremio/manifest.json`,
    });
  })
  .get('/members', (c) => {
    const rows = db
      .select({ id: members.id, name: members.name })
      .from(members)
      .orderBy(asc(members.nameKey), asc(members.id))
      .all();
    return c.json(rows);
  })
  .post('/members', zValidator('json', z.object({ name: memberName }), onInvalid), (c) => {
    const { name } = c.req.valid('json');
    const created = db
      .insert(members)
      .values({ name, nameKey: memberKey(name), createdAt: Date.now() })
      .onConflictDoNothing()
      .returning({ id: members.id, name: members.name })
      .get();
    if (!created) return c.json({ error: 'Name already exists' }, 409);
    logger.child({ function: 'addMember', id: created.id }).info('Member added');
    return c.json(created, 201);
  })
  .get(
    '/titles',
    zValidator('query', z.object({ status: z.enum(TITLE_STATUSES).optional() }), onInvalid),
    (c) => {
      const { status } = c.req.valid('query');
      const rows = db
        .select()
        .from(titles)
        .where(status ? eq(titles.status, status) : undefined)
        .orderBy(desc(titles.addedAt), desc(titles.id))
        .all();
      return c.json(rows.map(toDto));
    },
  )
  .post(
    '/titles',
    zValidator(
      'json',
      z.object({
        tmdbId: z.number().int().positive(),
        type: z.enum(TITLE_TYPES),
        addedBy: memberName,
      }),
      onInvalid,
    ),
    async (c) => {
      const { tmdbId, type, addedBy } = c.req.valid('json');
      const contextLogger = logger.child({ function: 'addTitle', tmdbId, type });

      const member = db
        .select({ name: members.name })
        .from(members)
        .where(eq(members.nameKey, memberKey(addedBy)))
        .get();
      if (!member) return c.json({ error: 'Unknown member' }, 400);

      const exists = db
        .select({ id: titles.id })
        .from(titles)
        .where(and(eq(titles.tmdbId, tmdbId), eq(titles.type, type)))
        .get();
      if (exists) return c.json({ error: 'Already in the list' }, 409);

      let details;
      try {
        details = await getDetails(type, tmdbId);
      } catch (err) {
        if (err instanceof TmdbError && err.status === 404) {
          return c.json({ error: 'Title not found on TMDB' }, 404);
        }
        contextLogger.error({ err: err instanceof Error ? err.message : 'unknown' }, 'Details fetch failed');
        return c.json({ error: 'Could not reach TMDB' }, 502);
      }

      // The unique index also guards the race between the check above and this insert.
      const inserted = db
        .insert(titles)
        .values({ ...details, addedBy: member.name, addedAt: Date.now() })
        .onConflictDoNothing()
        .returning()
        .get();
      if (!inserted) return c.json({ error: 'Already in the list' }, 409);

      contextLogger.info('Title added');
      return c.json(toDto(inserted), 201);
    },
  )
  .patch(
    '/titles/:id',
    zValidator('param', idParam, onInvalid),
    zValidator('json', z.object({ status: z.enum(TITLE_STATUSES) }), onInvalid),
    (c) => {
      const { id } = c.req.valid('param');
      const { status } = c.req.valid('json');
      const updated = db
        .update(titles)
        .set({ status, watchedAt: status === 'watched' ? Date.now() : null })
        .where(eq(titles.id, id))
        .returning()
        .get();
      if (!updated) return c.json({ error: 'Not found' }, 404);
      logger.child({ function: 'setStatus', id, status }).info('Status changed');
      return c.json(toDto(updated));
    },
  )
  .delete('/titles/:id', zValidator('param', idParam, onInvalid), (c) => {
    const { id } = c.req.valid('param');
    const deleted = db.delete(titles).where(eq(titles.id, id)).returning({ id: titles.id }).get();
    if (!deleted) return c.json({ error: 'Not found' }, 404);
    logger.child({ function: 'removeTitle', id }).info('Title removed');
    return c.json({ ok: true as const });
  })
  .get(
    '/search',
    zValidator('query', z.object({ q: z.string().trim().min(2).max(100) }), onInvalid),
    async (c) => {
      const { q } = c.req.valid('query');
      let hits;
      try {
        hits = await searchMulti(q);
      } catch (err) {
        logger
          .child({ function: 'search' })
          .error({ err: err instanceof Error ? err.message : 'unknown' }, 'Search failed');
        return c.json({ error: 'Could not reach TMDB' }, 502);
      }
      hits = hits.slice(0, 20);

      const saved = hits.length
        ? db
            .select({ tmdbId: titles.tmdbId, type: titles.type })
            .from(titles)
            .where(
              inArray(
                titles.tmdbId,
                hits.map((h) => h.tmdbId),
              ),
            )
            .all()
        : [];
      const inList = new Set(saved.map((s) => `${s.type}:${s.tmdbId}`));

      return c.json(
        hits.map((h) => ({
          tmdbId: h.tmdbId,
          type: h.type,
          title: h.title,
          year: h.year,
          posterUrl: posterUrl(h.posterPath),
          inList: inList.has(`${h.type}:${h.tmdbId}`),
        })),
      );
    },
  );
