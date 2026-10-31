import { z } from 'zod';
import type { TitleType } from '@shared/constants';
import { env } from '@server/env';
import { logger } from '@server/logger';
import type { NewTitleRow } from '@server/db/schema';

const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';
const LANGUAGE = 'fr-FR';
const TIMEOUT_MS = 8000;

// TMDB calls its series "tv"; we use Stremio's "series" everywhere else.
const TMDB_PATH: Record<TitleType, 'movie' | 'tv'> = { movie: 'movie', series: 'tv' };

export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TmdbError';
  }
}

/** Full poster URL (w342) or null. Built here so the client never composes TMDB URLs. */
export function posterUrl(posterPath: string | null): string | null {
  return posterPath ? `${IMAGE_BASE}${posterPath}` : null;
}

async function tmdbGet(path: string, params: Record<string, string>): Promise<unknown> {
  const contextLogger = logger.child({ function: 'tmdbGet', path });
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('language', LANGUAGE);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.TMDB_API_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    contextLogger.error({ err: err instanceof Error ? err.message : 'unknown' }, 'TMDB request failed');
    throw new TmdbError('TMDB unreachable', 502);
  }
  if (res.status === 404) throw new TmdbError('Not found on TMDB', 404);
  if (res.status === 429) {
    contextLogger.warn({ status: 429, retryAfter: res.headers.get('retry-after') }, 'TMDB rate limit hit');
    throw new TmdbError('TMDB rate limited', 502);
  }
  if (!res.ok) {
    contextLogger.error({ status: res.status }, 'TMDB returned an error');
    throw new TmdbError('TMDB error', 502);
  }
  return res.json();
}

const yearOf = (date: string | null | undefined): number | null => {
  const y = date ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN;
  return Number.isFinite(y) ? y : null;
};

const imdbIdOf = (v: string | null | undefined): string | null => (v && /^tt\d+$/.test(v) ? v : null);

export type SearchHit = {
  tmdbId: number;
  type: TitleType;
  title: string;
  year: number | null;
  posterPath: string | null;
};

const searchSchema = z.object({
  results: z.array(
    z.object({
      id: z.number().int(),
      media_type: z.string(),
      title: z.string().nullish(),
      name: z.string().nullish(),
      release_date: z.string().nullish(),
      first_air_date: z.string().nullish(),
      poster_path: z.string().nullish(),
    }),
  ),
});

/** Movies and series only (people are dropped), at most 20 hits as returned by TMDB. */
export async function searchMulti(query: string): Promise<SearchHit[]> {
  const data = searchSchema.parse(
    await tmdbGet('/search/multi', { query, include_adult: 'false', page: '1' }),
  );
  const hits: SearchHit[] = [];
  for (const r of data.results) {
    if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
    const isMovie = r.media_type === 'movie';
    const title = (isMovie ? r.title : r.name) ?? '';
    if (!title) continue;
    hits.push({
      tmdbId: r.id,
      type: isMovie ? 'movie' : 'series',
      title,
      year: yearOf(isMovie ? r.release_date : r.first_air_date),
      posterPath: r.poster_path ?? null,
    });
  }
  return hits;
}

const detailsSchema = z.object({
  id: z.number().int(),
  title: z.string().nullish(),
  name: z.string().nullish(),
  original_title: z.string().nullish(),
  original_name: z.string().nullish(),
  release_date: z.string().nullish(),
  first_air_date: z.string().nullish(),
  poster_path: z.string().nullish(),
  overview: z.string().nullish(),
  genres: z.array(z.object({ name: z.string() })).default([]),
  runtime: z.number().nullish(),
  episode_run_time: z.array(z.number()).optional(),
  external_ids: z.object({ imdb_id: z.string().nullish() }).optional(),
  imdb_id: z.string().nullish(),
});

export type TitleDetails = Omit<NewTitleRow, 'id' | 'addedBy' | 'status' | 'addedAt' | 'watchedAt'>;

/** Details + IMDb id, mapped to our row shape (minus who/when, which the route sets). */
export async function getDetails(type: TitleType, tmdbId: number): Promise<TitleDetails> {
  const kind = TMDB_PATH[type];
  const d = detailsSchema.parse(
    await tmdbGet(`/${kind}/${tmdbId}`, { append_to_response: 'external_ids' }),
  );
  const isMovie = type === 'movie';
  const title =
    (isMovie ? d.title || d.original_title : d.name || d.original_name) || `TMDB ${tmdbId}`;
  const episodeRuntimes = d.episode_run_time ?? [];
  const runtime = isMovie
    ? d.runtime || null
    : episodeRuntimes.length
      ? Math.round(episodeRuntimes.reduce((a, b) => a + b, 0) / episodeRuntimes.length)
      : null;

  return {
    tmdbId,
    type,
    imdbId: imdbIdOf(d.external_ids?.imdb_id) ?? imdbIdOf(d.imdb_id),
    title,
    year: yearOf(isMovie ? d.release_date : d.first_air_date),
    posterPath: d.poster_path ?? null,
    overview: d.overview || null,
    genres: JSON.stringify(d.genres.map((g) => g.name)),
    runtime,
  };
}
