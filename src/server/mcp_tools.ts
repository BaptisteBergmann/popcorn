import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { TITLE_STATUSES, TITLE_TYPES } from '@shared/constants';
import { logger } from '@server/logger';
import {
  addTitle,
  listTitles,
  removeTitle,
  searchTitles,
  setTitleStatus,
  titleId,
  type Result,
  type TitleDto,
  type WatchlistError,
} from '@server/watchlist';

// Tool descriptions are for the model, so they stay in English. Titles are in French (TMDB fr-FR).
// MCP never returns, changes or creates a hidden title: lists and searches never pass `member`,
// by-id tools use scope 'visible', and `add_title` hard-codes hidden: false.

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
});

const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

// Fixed texts only: the SDK copies thrown error text into tool results, so nothing thrown, and
// nothing from TMDB or the DB, ever reaches the model.
const ERROR_TEXT: Record<WatchlistError, string> = {
  tmdb_not_found: 'Title not found on TMDB.',
  tmdb_unreachable: 'Could not reach TMDB. Try again.',
  already_in_list: 'Already in the list.',
  not_found: 'Title not found. Use list_titles.',
  unknown_member: 'The request failed.',
  no_imdb_id: 'The request failed.',
};

type ToolContext = { memberName: string; grantId: string };

async function run(
  tool: string,
  ctx: ToolContext,
  fn: () => Result<unknown> | Promise<Result<unknown>>,
): Promise<ToolResult> {
  const contextLogger = logger.child({ function: 'mcpTool', tool, grantId: ctx.grantId });
  try {
    const result = await fn();
    if (!result.ok) {
      contextLogger.info({ code: result.code }, 'MCP tool call rejected');
      return fail(ERROR_TEXT[result.code]);
    }
    contextLogger.info('MCP tool call');
    return ok(result.value ?? 'Done');
  } catch (err) {
    contextLogger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'MCP tool call failed');
    return fail('The request failed.');
  }
}

const done = <T>(value: T): Result<T> => ({ ok: true, value });
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

// Never `hidden`, `hasImdb` or poster URLs.
const summary = (t: TitleDto) => ({
  id: t.id,
  tmdbId: t.tmdbId,
  type: t.type,
  title: t.title,
  year: t.year,
  imdbId: t.imdbId,
  inStremio: t.imdbId !== null,
  status: t.status,
});

export const instructionsFor = (memberName: string) =>
  `Shared movie and series watchlist. You are connected as "${memberName}": titles you add are credited to them. ` +
  'Titles are in French. Use search_titles first to find a tmdbId before add_title. ' +
  'Removing a title cannot be undone.';

export function registerTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    'search_titles',
    {
      title: 'Search titles on TMDB',
      description:
        'Searches movies and series on TMDB (French titles). Returns up to 20 hits with their tmdbId and type, and whether each is already in the list.',
      inputSchema: z.object({ query: z.string().trim().min(2).max(100).describe('Title to search for') }),
      annotations: { readOnlyHint: true },
    },
    ({ query }) =>
      run('search_titles', ctx, async () => {
        const result = await searchTitles(query);
        if (!result.ok) return result;
        return done(
          result.value.map((h) => ({
            tmdbId: h.tmdbId,
            type: h.type,
            title: h.title,
            year: h.year,
            inList: h.inList,
          })),
        );
      }),
  );

  server.registerTool(
    'list_titles',
    {
      title: 'List the watchlist',
      description:
        'Lists the titles in the shared watchlist, newest first. Filter by status or type. Overviews are long, so they are only included when includeOverview is true.',
      inputSchema: z.object({
        status: z.enum(TITLE_STATUSES).optional().describe('to_watch or watched'),
        type: z.enum(TITLE_TYPES).optional().describe('movie or series'),
        includeOverview: z.boolean().default(false).describe('Include the plot overview of each title'),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ status, type, includeOverview }) =>
      run('list_titles', ctx, () =>
        done(
          listTitles({ status, type }).map((t) => ({
            id: t.id,
            tmdbId: t.tmdbId,
            type: t.type,
            imdbId: t.imdbId,
            inStremio: t.imdbId !== null,
            title: t.title,
            year: t.year,
            genres: t.genres,
            runtime: t.runtime,
            addedBy: t.addedBy,
            status: t.status,
            addedAt: iso(t.addedAt),
            watchedAt: iso(t.watchedAt),
            ...(includeOverview ? { overview: t.overview } : {}),
          })),
        ),
      ),
  );

  server.registerTool(
    'add_title',
    {
      title: 'Add a title',
      description:
        'Adds a movie or series to the watchlist by its TMDB id (from search_titles), credited to the connected member. A title without an IMDb id (inStremio false) is saved but will not appear in Stremio.',
      inputSchema: z.object({
        tmdbId: z.number().int().positive().describe('TMDB id, from search_titles'),
        type: z.enum(TITLE_TYPES).describe('movie or series'),
      }),
      annotations: { destructiveHint: false },
    },
    ({ tmdbId, type }) =>
      run('add_title', ctx, async () => {
        const result = await addTitle({ tmdbId, type, addedBy: ctx.memberName, hidden: false });
        if (!result.ok) return result;
        // `created` and `addedBy` are left out so a defused surprise looks like a new add.
        return done(summary(result.value.title));
      }),
  );

  server.registerTool(
    'set_title_status',
    {
      title: 'Set a title status',
      description: 'Marks a title as watched or back to to_watch. Use the id from list_titles.',
      inputSchema: z.object({
        id: titleId.describe('Title id, from list_titles'),
        status: z.enum(TITLE_STATUSES).describe('to_watch or watched'),
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    ({ id, status }) =>
      run('set_title_status', ctx, () => {
        const result = setTitleStatus(id, status, 'visible');
        if (!result.ok) return result;
        return done({ ...summary(result.value), watchedAt: iso(result.value.watchedAt) });
      }),
  );

  server.registerTool(
    'remove_title',
    {
      title: 'Remove a title',
      description: 'Removes a title from the watchlist. This cannot be undone. Use the id from list_titles.',
      inputSchema: z.object({ id: titleId.describe('Title id, from list_titles') }),
      annotations: { destructiveHint: true },
    },
    ({ id }) =>
      run('remove_title', ctx, () => {
        const result = removeTitle(id, 'visible');
        return result.ok ? done({ removed: true }) : result;
      }),
  );
}
