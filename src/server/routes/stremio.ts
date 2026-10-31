import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { TITLE_STATUSES, TITLE_TYPES, type TitleStatus, type TitleType } from '@shared/constants';
import { db } from '@server/db';
import { titles } from '@server/db/schema';
import { posterUrl } from '@server/tmdb';

// Bump `version` whenever catalogs or other manifest fields change. Never change `id`.
const MANIFEST = {
  id: 'local.popcorn.watchlist',
  version: '1.0.1',
  name: 'Popcorn',
  description: 'Notre liste de films et séries à voir',
  resources: ['catalog'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [
    { type: 'movie', id: 'to_watch', name: 'Popcorn · À voir' },
    { type: 'series', id: 'to_watch', name: 'Popcorn · À voir' },
    { type: 'movie', id: 'watched', name: 'Popcorn · Déjà vus' },
    { type: 'series', id: 'watched', name: 'Popcorn · Déjà vus' },
  ],
};

const isType = (v: string): v is TitleType => (TITLE_TYPES as readonly string[]).includes(v);
const isStatus = (v: string): v is TitleStatus => (TITLE_STATUSES as readonly string[]).includes(v);

export const stremio = new Hono()
  // Stremio clients fetch the addon cross-origin; this is the only place CORS is opened.
  .use(cors({ origin: '*' }))
  // Short cache so list changes show up quickly and Cloudflare doesn't hold stale lists.
  .use(async (c, next) => {
    await next();
    c.header('Cache-Control', 'max-age=60');
  })
  .get('/manifest.json', (c) => c.json(MANIFEST))
  .get('/catalog/:type/:file', (c) => {
    const { type, file } = c.req.param();
    const id = file.endsWith('.json') ? file.slice(0, -'.json'.length) : null;
    if (!id || !isType(type) || !isStatus(id)) return c.json({ error: 'Not found' }, 404);

    const rows = db
      .select()
      .from(titles)
      // Titles without an IMDb id can't be resolved by Cinemeta, so they stay out of catalogs.
      .where(and(eq(titles.type, type), eq(titles.status, id), isNotNull(titles.imdbId)))
      .orderBy(desc(titles.addedAt), desc(titles.id))
      .all();

    const metas = rows.map((r) => ({
      id: r.imdbId,
      type: r.type,
      name: r.title,
      poster: posterUrl(r.posterPath) ?? undefined,
      releaseInfo: r.year ? String(r.year) : undefined,
      description: r.overview ?? undefined,
    }));
    return c.json({ metas });
  });
