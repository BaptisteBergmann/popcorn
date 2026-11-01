import { zValidator } from '@hono/zod-validator';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { TITLE_STATUSES, TITLE_TYPES } from '@shared/constants';
import { db } from '@server/db';
import { memberKey, members, titles } from '@server/db/schema';
import { env } from '@server/env';
import { logger } from '@server/logger';
import {
  addTitle,
  listTitles,
  memberName,
  removeTitle,
  searchTitles,
  setTitleStatus,
  toDto,
} from '@server/watchlist';

// Small `{ error }` body instead of the validator's default payload.
const onInvalid = (result: { success: boolean }, c: Context) => {
  if (!result.success) return c.json({ error: 'Invalid input' }, 400);
};

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
    zValidator(
      'query',
      z.object({
        status: z.enum(TITLE_STATUSES).optional(),
        member: memberName.optional(),
      }),
      onInvalid,
    ),
    (c) => c.json(listTitles(c.req.valid('query'))),
  )
  .post(
    '/titles',
    zValidator(
      'json',
      z.object({
        tmdbId: z.number().int().positive(),
        type: z.enum(TITLE_TYPES),
        addedBy: memberName,
        hidden: z.boolean().default(false),
      }),
      onInvalid,
    ),
    async (c) => {
      const result = await addTitle(c.req.valid('json'));
      if (result.ok) return c.json(result.value.title, result.value.created ? 201 : 200);
      // Literal statuses keep the inferred response types the web client relies on.
      switch (result.code) {
        case 'unknown_member':
          return c.json({ error: 'Unknown member' }, 400);
        case 'tmdb_not_found':
          return c.json({ error: 'Title not found on TMDB' }, 404);
        case 'no_imdb_id':
          return c.json({ error: 'No IMDb id' }, 422);
        case 'tmdb_unreachable':
          return c.json({ error: 'Could not reach TMDB' }, 502);
        default:
          return c.json({ error: 'Already in the list' }, 409);
      }
    },
  )
  .patch(
    '/titles/:id',
    zValidator('param', idParam, onInvalid),
    zValidator('json', z.object({ status: z.enum(TITLE_STATUSES) }), onInvalid),
    (c) => {
      const { id } = c.req.valid('param');
      const { status } = c.req.valid('json');
      const result = setTitleStatus(id, status, 'all');
      if (!result.ok) return c.json({ error: 'Not found' }, 404);
      return c.json(result.value);
    },
  )
  .post('/titles/:id/reveal', zValidator('param', idParam, onInvalid), (c) => {
    const { id } = c.req.valid('param');
    const updated = db
      .update(titles)
      .set({ hidden: false })
      .where(eq(titles.id, id))
      .returning()
      .get();
    if (!updated) return c.json({ error: 'Not found' }, 404);
    logger.child({ function: 'revealTitle', id }).info('Title revealed');
    return c.json(toDto(updated));
  })
  .delete('/titles/:id', zValidator('param', idParam, onInvalid), (c) => {
    const { id } = c.req.valid('param');
    if (!removeTitle(id, 'all').ok) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true as const });
  })
  .get(
    '/search',
    zValidator(
      'query',
      z.object({
        q: z.string().trim().min(2).max(100),
        member: memberName.optional(),
      }),
      onInvalid,
    ),
    async (c) => {
      const { q, member } = c.req.valid('query');
      const result = await searchTitles(q, member);
      if (!result.ok) return c.json({ error: 'Could not reach TMDB' }, 502);
      return c.json(result.value);
    },
  );
