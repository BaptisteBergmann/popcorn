import type { TitleStatus } from '@shared/constants';
import type { TitleDto } from '@web/lib/api';

export const SORTS = ['added', 'title', 'year_desc', 'year_asc', 'watched'] as const;
export type ListSort = (typeof SORTS)[number];

export const MAX_QUERY_LENGTH = 100;

// Accent- and case-insensitive so "amelie" finds "Amélie".
export function normalizeForSearch(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').trim();
}

export function matchesQuery(title: string, normalizedQuery: string): boolean {
  return normalizedQuery === '' || normalizeForSearch(title).includes(normalizedQuery);
}

// URL params are untrusted: unknown values, and "watched" outside the Watched tab, fall back to the default.
export function parseSort(raw: string | null, status: TitleStatus): ListSort {
  const found = SORTS.find((s) => s === raw);
  if (!found || (found === 'watched' && status !== 'watched')) return 'added';
  return found;
}

const byTitle = (a: TitleDto, b: TitleDto) =>
  a.title.localeCompare(b.title, 'fr', { sensitivity: 'base', numeric: true });
const byNewestAdded = (a: TitleDto, b: TitleDto) => b.addedAt - a.addedAt || b.id - a.id;

// Titles without a year always go last, whatever the direction.
function byYear(dir: 1 | -1) {
  return (a: TitleDto, b: TitleDto) => {
    if (a.year === null && b.year === null) return byTitle(a, b);
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return (a.year - b.year) * dir || byTitle(a, b);
  };
}

const byWatched = (a: TitleDto, b: TitleDto) => {
  if (a.watchedAt === null && b.watchedAt === null) return b.id - a.id;
  if (a.watchedAt === null) return 1;
  if (b.watchedAt === null) return -1;
  return b.watchedAt - a.watchedAt || b.id - a.id;
};

// Returns a copy: the query cache array must never be mutated.
export function sortTitles(items: TitleDto[], sort: ListSort): TitleDto[] {
  const compare = {
    added: byNewestAdded,
    title: byTitle,
    year_desc: byYear(-1),
    year_asc: byYear(1),
    watched: byWatched,
  }[sort];
  return [...items].sort(compare);
}

export function applyListFilters(
  items: TitleDto[],
  type: 'all' | TitleDto['type'],
  q: string,
  sort: ListSort,
): TitleDto[] {
  const normalizedQuery = normalizeForSearch(q);
  const matched = items.filter(
    (t) => (type === 'all' || t.type === type) && matchesQuery(t.title, normalizedQuery),
  );
  return sortTitles(matched, sort);
}
