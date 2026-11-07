# List search and sort

## Status: implemented
Shipped as planned: client-side search (`q`) and sort (`sort`) on the list page, helpers in `src/web/lib/list_filters.ts`, new `ui/select.tsx`. Deviations: `updateMany` helper so "Tout afficher" clears `q` and `type` in one URL update; the result count `role=status` region lives in `ListPage` (always mounted); the field syncs from `q` when it changes externally; controls hidden only once both lists are loaded and empty.

## Goal
As the watchlist grows, finding a title already in it means scrolling. Add a text search
over the titles in the list and a sort control on the list page, both combined with the
existing type filter and applied in both tabs.

## Out of scope
- TMDB search (stays on the add page) and any TMDB call.
- Searching overview, genres or "added by" (only the title name for now).
- Original title and rating sorts/search: neither is stored (see Data). Adding them needs a
  migration plus a TMDB backfill for existing rows, so it's a separate plan if wanted.
- Server-side filtering or sorting, pagination.
- Changing what the Stremio catalogs return or how they order.

## Current state
- `src/web/pages/list_page.tsx`: `ListPage` keeps `tab` and `type` in URL search params via
  a local `update(key, value)` helper (`setParams(..., { replace: true })`, default values
  are deleted from the URL). `TabPanel` gets `filter` + `onResetFilter`, filters
  `query.data` client-side by type, shows `EmptyState` with a reset link
  (`copy.emptyFilterMovies/Series`, `copy.emptyFilterReset`) when nothing matches, else
  `<TitleGrid items tab>`. Tab counts use the unfiltered `data.length`.
- Data: `useTitles(status, member)` in `src/web/lib/api.ts`, `TitleDto` from
  `toDto` in `src/server/watchlist.ts`: `id, tmdbId, type, imdbId, hasImdb, title, year,
  posterUrl, overview, genres, runtime, addedBy, status, addedAt, watchedAt, hidden`.
  No `originalTitle`, no rating.
- Server order (`listTitles` in `src/server/watchlist.ts`): `addedAt desc, id desc`, for
  both statuses. Optimistic updates in `api.ts` keep cached lists in that order
  (`byNewest`). So today the Watched tab is also "recently added", not "recently watched".
- `src/web/lib/use_debounced_value.ts` exists (used by the add page search).
- `src/web/components/ui/`: `input`, `toggle_group`, `tabs`, `button`, `dialog`,
  `alert_dialog`, ... No select/dropdown. `radix-ui` (monopackage, already a dependency)
  includes `Select` and `DropdownMenu`, so a Shadcn `select.tsx` can be added with no new
  dependency, if the designer picks one.
- Text normalization precedent: `src/shared/member_key.ts` (`normalize('NFC')` +
  `toLocaleLowerCase('fr')`).

## Approach
Pure client-side, in the list page. Copy the existing type-filter pattern:

1. **Search**: a `q` URL param. The input holds local state for responsiveness, debounced
   (~200 ms, `useDebouncedValue`) before writing `q` to the URL with `replace`. Matching:
   normalize both sides with `normalize('NFD')`, strip combining marks
   (`/\p{M}/gu`), `toLocaleLowerCase('fr')`, trim, then `includes`. So "amelie" matches
   "Amélie", "LA HAINE" matches "La Haine". Empty query = no filtering.
2. **Sort**: a `sort` URL param with options derived from stored fields:
   - `added` (default, omitted from URL): `addedAt desc, id desc`, identical to server order.
   - `title`: A to Z with `localeCompare(..., 'fr', { sensitivity: 'base', numeric: true })`.
   - `year_desc`: newest release first; `null` years last; tie-break `title`.
   - `year_asc`: oldest first; `null` last. (Designer may drop one of the two year options.)
   - `watched`: `watchedAt desc` (nulls last), tie-break `id desc`. Offered only on the
     Watched tab; if `sort=watched` is in the URL on the To watch tab, fall back to `added`.
   Unknown values fall back to `added`. One `sort` param shared by both tabs.
3. Pipeline in `TabPanel`: `data` → type filter → search → sort → `TitleGrid`. Sort with
   `[...arr].sort()` in a `useMemo` (never mutate the query cache array).
4. Put the pure helpers (`normalizeForSearch`, `matchesQuery`, `SORTS`, `sortTitles`,
   `parseSort`) in a new `src/web/lib/list_filters.ts` so `list_page.tsx` stays readable.
5. **Empty states** (in this order of precedence, after the existing "list is empty" ones):
   - search active and nothing matches (with or without a type filter): `copy.searchEmptyTitle(q)`
     plus a reset action that clears `q` (and the type filter if one is set:
     `copy.searchEmptyReset` = "Tout afficher"-style). Clearing must also reset the input's
     local state.
   - type filter only, nothing matches: unchanged existing behavior.
6. Tab counts stay the unfiltered totals (unchanged). The designer may decide to show a
   "n résultats" line while searching; the data for it is `filtered.length`.
7. Clearing: the input gets a clear button (copy the add page pattern, `copy.addClearAria`
   equivalent) and Escape clears it.

Alternative considered: server-side `q`/`sort` params on `GET /api/titles`. Rejected: the
lists are small and already fully loaded, it would change query keys (breaking optimistic
update snapshots and the PWA network-first cache key) and wouldn't work offline.

Keeping `q` in the URL (replace, not push) means reload and back/forward-to-list keep the
search, and it doesn't pollute history. Initial input state is read from `q` on mount.

## Data and migrations
- None. No schema change, no migration.

## API
- None. `GET /api/titles` unchanged (order, params, response).

## Access and security
- No new routes. Search text stays in the browser; it's in the SPA URL under `/<token>/`,
  which is already covered by `Referrer-Policy: no-referrer`.
- URL params are untrusted input: `sort` is parsed against a fixed list, `type` as today,
  `q` is only used as a plain substring (no regex built from it); cap it at e.g. 100 chars
  (`maxLength` on the input, `slice` when read from the URL).

## Stremio impact
- None. Catalogs, manifest and `version` unchanged; ids still IMDb.

## Steps
1. Add `src/web/lib/list_filters.ts` with the normalize/match/sort helpers and the sort
   option list (typed union `ListSort`). Commit `feat(web): add list search and sort helpers`.
   — files: `src/web/lib/list_filters.ts`
2. Add Shadcn `select.tsx` (radix `Select` from `radix-ui`, repo naming `snake_case`, `cn`,
   lucide icons), as the design requires it. Commit `feat(ui): add select component`.
   — files: `src/web/components/ui/select.tsx`
3. Wire search + sort in the list page: read/write `q` and `sort` via the existing `update`
   helper, debounced input, pass `query` / `sort` / reset callbacks to `TabPanel`, apply the
   pipeline, new empty state. Add strings to `copy.ts` (French, see Design > Copy). Commit
   `feat(web): search and sort the watchlist`.
   — files: `src/web/pages/list_page.tsx`, `src/web/lib/copy.ts`
4. `pnpm typecheck && pnpm lint`; CHANGELOG entries after each commit per CLAUDE.md.

## Design

### User flow
1. Open the list → tabs, type toggle, then a search field and a sort select, then the grid.
2. Type in the search field → grid filters after ~200 ms and a result count appears under the controls.
3. Tap the sort select → listbox of options; pick one → grid reorders, trigger shows the choice.
4. Nothing matches → search empty state with "Tout afficher", which clears the query and the type filter.
5. Tap X or press Escape in the field → query cleared, focus stays in the field, full list returns.

### Screens
#### List page controls (`src/web/pages/list_page.tsx`)
Wireframe (mobile, 375px):
```
[ À voir · 12 | Vus · 5 ]            <- TabsList (unchanged)
[ Tout | Films | Séries ]            <- ToggleGroup (unchanged)
[🔍 Chercher dans la liste…   (x)]   <- Input, full width, h-11
[⇅ Ajout récent             v ]      <- Select trigger, full width, h-11
3 résultats                          <- only while q is active
┌────┐ ┌────┐ ┌────┐
│    │ │    │ │    │  grid
```
Wireframe (sm and up):
```
[ À voir · 12 | Vus · 5 ]                         [ Tout | Films | Séries ]
[🔍 Chercher dans la liste…        (x)]  [⇅ Ajout récent  v ]
3 résultats
grid
```
- Layout: the existing header row (tabs + type toggle) is unchanged. Add a new row directly
  below it, inside `Tabs`, before the `pt-3` grid wrapper: `flex flex-col gap-3 sm:flex-row`,
  wrapped in `<div role="search">`. Mobile: input then select, each full width, stacked
  (side by side at 375px would squeeze the placeholder; stacking keeps 44px targets).
  From `sm`: one row, input `flex-1 sm:max-w-sm`, select `sm:w-52`. The row is rendered once,
  outside the `TabsContent`s, so the input keeps focus and value when switching tabs.
- Result count: `<p>` under the row, `text-sm text-muted-foreground`, shown only when the
  debounced `q` is non-empty and there are matches (count = filtered length after type +
  search; `TabPanel` renders it above the grid since it owns the filtered array). Not shown
  in the search empty state (the empty state already says it).
- Components: reuse `Input` (`src/web/components/ui/input.tsx`), `Button` ghost icon for
  clear, lucide `Search` and `X`, copying the add page markup (`add_page.tsx` ~L115-150:
  `type="search"`, `enterKeyHint="search"`, `autoComplete="off"`, `maxLength={100}`,
  `[&::-webkit-search-cancel-button]:hidden`, left Search icon, right 44px clear button
  only when the input is non-empty). Use `h-11` (secondary control; add page uses `h-12`).
  New: `src/web/components/ui/select.tsx`, Shadcn Select built from `Select` in `radix-ui`
  (Root, Trigger, Value, Portal, Content, Viewport, Item, ItemText, ItemIndicator), `cn`,
  lucide `ChevronDown` and `Check`. Trigger `h-11 w-full`, `rounded-md border border-input
  bg-background px-3 text-sm`, `focus-visible:ring-2 focus-visible:ring-ring`. Items
  `min-h-11`. Content gets `motion-reduce:animate-none`.
- Why Select, not dropdown menu or toggle group: five exclusive options with long labels
  don't fit a toggle group at 375px; Select shows the current value in the trigger and has
  proper listbox semantics and typeahead. So plan step 2 is needed.
- Typography and color: existing tokens only (`bg-background`, `border-input`,
  `text-foreground`, `text-muted-foreground`, `ring-ring`, `bg-accent` for the highlighted
  item). Trigger has a leading lucide `ArrowUpDown` (16px, `text-muted-foreground`,
  `aria-hidden`) so it reads as "sort" without a visible label. Dark mode follows the tokens.
- Interactions:
  - Input state is local, initialised from `q`; the debounced value (200 ms) is written to
    the URL via `update('q', ...)`. Clearing (X, Escape, reset action) sets local state to ''
    and calls `update('q', null)` immediately, no debounce wait.
  - Escape in a non-empty field: clear it and `preventDefault`. In an empty field: do nothing.
    Clear button click refocuses the input.
  - Enter: blur the input to dismiss the mobile keyboard so results are visible.
  - Select: `value={sort}`, `onValueChange={(v) => update('sort', v === 'added' ? null : v)}`.
    Options: Ajout récent, Titre (A–Z), Plus récents, Plus anciens, and "Vu récemment" only
    when `tab === 'watched'`. Keep both year directions. If the URL has `sort=watched` on
    To watch, the trigger shows the parsed fallback "Ajout récent"; URL left as is.
  - Switching tab keeps `q`, `sort` and `type`.
  - Search and sort stay enabled offline (no `disabled={!online}`, unlike the add page).

#### Search empty state
- Reuse `EmptyState` with `icon={Search}`, `title={copy.searchEmptyTitle(q)}`, no body,
  `action={<Button variant="link" onClick={onResetSearch}>{copy.searchEmptyReset}</Button>}`.
- `onResetSearch` clears `q` and `type` and resets the input's local state. It takes
  precedence over the type-only empty state. The title must wrap long queries
  (`break-words` if `EmptyState` doesn't already handle it).

### States
- Loading: unchanged (`TitleGridSkeleton`). The controls row stays rendered to avoid layout shift.
- Empty (no titles at all): unchanged empty states. Recommended: render the controls row only
  when `toWatch.data` or `watched.data` is non-empty (no controls over nothing).
- Empty (no match): search empty state above.
- Error: unchanged; controls remain visible and harmless.
- Success: no toast; the grid updating plus the result count is the feedback.
- Slow network / offline: no network involved, works on cached data. The offline banner says
  read-only; search and sort are not mutations.

### Copy
| Key | Text |
|-----|------|
| listSearchPlaceholder | Chercher dans la liste… |
| listSearchAria | Chercher dans la liste |
| listSearchClearAria | Effacer la recherche |
| sortAria | Trier |
| sortAdded | Ajout récent |
| sortTitle | Titre (A–Z) |
| sortYearDesc | Plus récents |
| sortYearAsc | Plus anciens |
| sortWatched | Vu récemment |
| searchResultCount(n) | `1 résultat` / `${n} résultats` |
| searchEmptyTitle(q) | Aucun titre pour « ${q} » |
| searchEmptyReset | Tout afficher |

Use non-breaking spaces inside « » in `searchEmptyTitle`.

### Accessibility
- Input has `aria-label={copy.listSearchAria}` (placeholder is not a label); wrapper `role="search"`.
- Select trigger has `aria-label={copy.sortAria}`; Radix gives listbox roles, arrow keys,
  typeahead and focus return to the trigger on close.
- Clear button: 44px, `aria-label`, X icon `aria-hidden`; focus returns to the input after click.
- Result count `<p role="status" aria-live="polite">`, always mounted (empty text when no
  query) so changes are announced. Already debounced, so not chatty. The empty state is
  visible text; no extra announcement needed.
- Focus order: tabs, type toggle, search, clear, sort, grid. All controls use the existing
  `focus-visible:ring-2 ring-ring` pattern.
- Contrast: existing tokens only. Reduced motion: Radix Select animations get `motion-reduce:` opt-outs.
- Standalone PWA: Select content is portaled and kept in the viewport by Radix; no new safe-area work.

### Questions
- Hide the controls row when both lists are empty (recommended)?
- Watched tab default stays "Ajout récent" per the plan. Prefer "Vu récemment" there instead?
- Result count only while searching, not for sort/type alone: OK?

## Risks and open questions
- Original title and rating aren't stored, so "search original title" and "sort by rating"
  aren't possible without a migration + TMDB backfill. Want a follow-up plan for that?
- One shared `sort` for both tabs vs per tab: plan uses one; `watched` falls back to
  `added` on To watch. Watched tab default stays "recently added" (current behavior) rather
  than switching to "recently watched". Say if you'd prefer the latter as Watched default.
- Optimistic updates insert rows in `byNewest` order; since sorting happens at render time
  on a copy, any sort stays correct after mark watched/undo/remove.
- Drift: none found between CLAUDE.md and the code for this area.

## How to verify
1. `pnpm dev`, open `/<token>/`. Type "amelie" (or a lowercase, accentless version of a
   title in the list): the matching card shows in To watch; switch to Watched: the search
   still applies there.
2. Combine with the type filter (Films + query) and check only matching movies show.
3. Search for nonsense: the search empty state shows; its reset action clears the input and
   shows the full list again.
4. Each sort option orders cards as described; titles with no year go last; "Vu récemment"
   only appears on Watched. Default order is identical to before the change.
5. Reload: `q`, `sort`, `type`, `tab` survive; browser back does not step through each
   keystroke. Edit the URL to `sort=bogus`: falls back to default, no error.
6. Mark a title watched / undo / remove while sorted by title: list stays sorted.
7. Offline (devtools): search and sort still work on cached data.
8. Wrong token: `/<wrong>/?q=x` returns the bare 404, as before.
9. Stremio: catalogs unchanged (same items, same order).
