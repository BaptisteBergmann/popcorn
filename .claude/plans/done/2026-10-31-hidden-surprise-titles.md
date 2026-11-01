## Status: implemented

Shipped: `hidden` flag on titles (migration), hidden-aware API (add as surprise, reveal, watched reveals, per-member visibility), Stremio catalogs excluding hidden titles outside the random ones, web hooks and UI to add and reveal surprises.

Deviations:
- A prettier run reformatted api/stremio routes; reverted in `1f32bd1` (restore repo quote style).
- `useSetStatus` gained a `wasHidden` variable so the toast/undo can account for a surprise being revealed by marking it watched.
- Round 2 review fixes: `markInList` limited to the adder's cached searches (others invalidated); list queries gated until the member resolves; duplicate `mt-2` removed on the card; the add route re-runs the defuse branch when a concurrent insert wins the race instead of returning 409; wrapped calls collapsed back to single lines.

# Hidden "surprise" titles

Status: approved
Approved by:

## Goal
Let a member add a title as a hidden "surprise": it stays out of everyone else's web
watchlist, search states and the regular Stremio catalogs, but can come up in the Stremio
"Au hasard" (random) catalogs, so the other person gets surprised when browsing random.

## Out of scope
- Real per-member privacy. There are no accounts; visibility follows the member picked
  on the device (localStorage), so anyone can switch the picker and see someone else's
  surprises. That's fine for a group that trusts each other.
- Weighting the random pick toward surprises (it stays a uniform pick over unwatched titles).
- Hiding an existing visible title afterwards (the others have already seen it).
- A dedicated "surprises" page or a counter of hidden titles.

## Current state
- `titles` table (`src/server/db/schema.ts`): unique `(tmdb_id, type)`, `added_by` holds
  the canonical `members.name` (resolved via `memberKey` in `POST /api/titles`), `status`
  `to_watch | watched`. Last migration: `drizzle/0002_productive_scrambler.sql`.
- `src/server/routes/api.ts`:
  - `GET /api/titles?status=` returns every row of that status.
  - `POST /api/titles { tmdbId, type, addedBy }`: 400 unknown member, 409 if `(tmdbId,type)`
    exists, then TMDB `getDetails`, insert.
  - `PATCH /api/titles/:id { status }` sets `watched_at`. `DELETE /api/titles/:id`.
  - `GET /api/search?q=` flags each hit `inList` if any row matches.
- `src/server/routes/stremio.ts` (commit f3ba466): manifest `1.1.0` with `to_watch`,
  `watched` and `random` catalogs per type. `random` = one `to_watch` row of that type with
  an IMDb id, `ORDER BY random() LIMIT 1`, re-rolled per fetch behind the 60 s `Cache-Control`.
  `to_watch` / `watched` = all rows of that status with an IMDb id, newest first.
- Web: `src/web/lib/api.ts` hooks `useTitles(status)` (key `['titles', status]`),
  `useSearch(q)`, `useAddTitle`, `useSetStatus` and `useRemoveTitle` (both optimistic,
  snapshot/restore on the exact keys `['titles','to_watch']` and `['titles','watched']`).
  Selected member comes from `useMember()` in `src/web/lib/member.tsx` (which itself
  imports `useMembers` from `api.ts`, so `api.ts` must not import `member.tsx`).
  Used by `pages/list_page.tsx`, `pages/add_page.tsx`, `components/title_card.tsx`,
  `components/search_result_row.tsx`, `components/remove_dialog.tsx`.
- PWA (`vite.config.ts`): network-first runtime cache for `/api/(titles|config|members)`,
  matched on pathname, so the query string is part of the cache key.

## Approach
Add a `hidden` boolean on `titles`. The owner of a surprise is the existing `added_by`.
The web API takes the selected member as an optional `member` query param, used only to
decide what to show (soft visibility):

- **Web list**: `GET /api/titles` returns visible titles plus hidden titles where
  `added_by = member`. So the adder sees and manages their own surprises (with a
  "surprise" marker, a Reveal action, mark watched, remove); everyone else gets nothing:
  no card, no placeholder, and counts are computed from the returned rows, so they don't
  leak either. A neutral placeholder was considered and rejected: "1 surprise waiting"
  already spoils part of the surprise, and it needs extra UI for nothing.
- **Search**: `inList` is true for visible titles and for the requester's own hidden
  titles. For someone else's hidden title it is `false`, so the Add button looks normal.
- **Duplicate (someone else adds a title that is hidden by another member)**: the server
  reveals the existing row (`hidden = false`, `added_by` unchanged) and returns `200` with
  the title. From the second person's side it's an ordinary add; they picked the title
  themselves so nothing is spoiled, and the surprise is simply defused. Returning 409
  ("already in the list") would spoil it, and silently pretending success while keeping it
  hidden would leave them with a title that never shows up and an Add button that keeps
  coming back. The same rule applies if the second person also asked for a surprise (rare
  coincidence; it becomes a normal title). Re-adding your own hidden title, or adding as
  hidden a title that's already visible, stays `409` as today.
- **Reveal / watched**: a hidden title becomes normal when it's marked watched
  (`PATCH status=watched` also sets `hidden = false`) or when the adder taps Reveal
  (`POST /api/titles/:id/reveal`). Unmarking watched does not re-hide it.
- **Stremio**: `random` includes hidden titles (current query already does, just keep it).
  `to_watch` and `watched` exclude hidden titles; showing them in the full "À voir" row
  would spoil the surprise.
- **No IMDb id**: a surprise that can't reach Stremio is pointless, so `POST` with
  `hidden: true` returns `422 { error }` if TMDB has no IMDb id; the UI says so and the
  user can add it normally instead.

Alternative considered: a separate `hidden_by` column instead of reusing `added_by`.
Rejected: `added_by` is always set for new titles and already means "who added it".

## Data and migrations
- `titles.hidden`: `integer('hidden', { mode: 'boolean' }).notNull().default(false)`.
- `pnpm db:generate` produces `drizzle/0003_*.sql` with a single
  `ALTER TABLE titles ADD hidden integer DEFAULT false NOT NULL`. Additive and safe:
  existing rows become `hidden = false` (current behavior). Applied at server start like
  previous migrations; nothing touches the `/data` volume otherwise. Builder checks the
  generated SQL is just that `ALTER` (no table rebuild).
- Add `hidden` to `toDto` in `api.ts` (`hidden: row.hidden`).

## API
All in `src/server/routes/api.ts`, chained on the existing `api` Hono app.
- `GET /api/titles?status=&member=`: `member` = `memberName.optional()`. Where clause:
  status filter AND (`hidden = false` OR (`hidden = true` AND `added_by = member`)). Without
  `member`, only visible rows. `added_by` holds the canonical name and the client sends the
  name from `/api/members`, so a direct `eq` is enough. Response: `TitleDto[]` now with
  `hidden: boolean`.
- `GET /api/search?q=&member=`: `member` optional, same rule for `inList` (select `hidden`
  and `addedBy` along with `tmdbId,type`; a row counts if `!hidden || addedBy === member`).
- `POST /api/titles { tmdbId, type, addedBy, hidden? }`: `hidden: z.boolean().default(false)`.
  - Existing row, `hidden` and `addedBy !== member.name` → update `hidden = false`, return
    `200` with the DTO, log `'Surprise defused'` (ids only).
  - Existing row otherwise → `409` (unchanged).
  - `hidden: true` and `details.imdbId === null` → `422 { error: 'No IMDb id' }`, nothing inserted.
  - Insert includes `hidden`. Response `201` (unchanged).
- `PATCH /api/titles/:id { status }`: when `status === 'watched'`, also set `hidden = false`.
- New `POST /api/titles/:id/reveal` (param `idParam`): sets `hidden = false`, `200` DTO,
  `404` if not found. Idempotent (revealing a visible title just returns it).
- `DELETE` unchanged.

## Access and security
- Every route above is on the existing `api` sub-app, mounted under the gated `/:token`
  app in `src/server/app.ts`; the new `/titles/:id/reveal` route inherits the gate. No
  route outside it.
- Inputs validated with `zValidator`: `member` reuses `memberName` (trimmed, 1–30),
  `hidden` is `z.boolean()`, `id` uses `idParam`. Errors use the existing `onInvalid` `{ error }`.
- `member` only narrows what's returned; it grants nothing beyond what the token already
  allows (a token holder can already read and delete everything). Log lines use ids,
  never titles, so surprise names don't sit in logs any more than today.

## Stremio impact
- `src/server/routes/stremio.ts`: add `eq(titles.hidden, false)` to the `to_watch` /
  `watched` query; leave the `random` query including hidden titles (add a comment saying
  that's deliberate).
- Manifest: no catalog added, removed or renamed, and no manifest field changes, so per
  CLAUDE.md no `version` bump is required (Stremio fetches catalog contents fresh anyway).
  Ids stay IMDb `tt…`; hidden titles without one can't exist (422 above).
- 60 s `Cache-Control` means a newly added surprise can take up to a minute to appear in
  random, and a hidden title may still sit in a cached `to_watch` response for up to 60 s
  only if it was visible before, which can't happen (hide-after-the-fact is out of scope).

## Steps
1. Schema + migration: add `hidden` to `titles`, run `pnpm db:generate`, check the SQL,
   `pnpm typecheck`. Commit `feat(db): add hidden flag to titles`. — files:
   `src/server/db/schema.ts`, `drizzle/0003_*.sql`, `drizzle/meta/*`
2. API: `hidden` in `toDto`; `member` param on `GET /titles` and `GET /search`; `hidden`
   on `POST /titles` with the defuse / 409 / 422 rules; `PATCH` watched reveals; new
   `POST /titles/:id/reveal`. The web still compiles (new fields are optional/additive).
   Commit `feat(api): support hidden surprise titles`. — files: `src/server/routes/api.ts`
3. Stremio: exclude hidden from `to_watch`/`watched`, keep them in `random`. Commit
   `feat(stremio): keep surprises out of regular catalogs`. — files: `src/server/routes/stremio.ts`
4. Hooks: in `src/web/lib/api.ts`
   - `useTitles(status, member: string | null)` → key `['titles', status, member]`, sends
     `member` when set. `useSearch(q, member)` → key `['search', q, member]`.
     Pass `member` from the callers (`list_page.tsx`, `add_page.tsx`) via `useMember()`;
     don't import `member.tsx` from `api.ts` (circular).
   - `useAddTitle` vars gain `hidden: boolean`; send it. `200` and `201` both go through
     `onSuccess` (`res.ok`). Add a `422` branch in `onError` with its own toast. Success
     toast differs for a surprise (copy from the designer).
   - `useSetStatus` / `useRemoveTitle`: switch optimistic updates to prefix matching
     (`qc.setQueriesData({ queryKey: ['titles', from] }, …)`) and snapshot with
     `qc.getQueriesData({ queryKey: ['titles'] })` / restore each entry, so they work with
     the member in the key. Moving to watched sets `hidden: false` on the optimistic copy.
   - New `useRevealTitle()`: `POST /titles/:id/reveal`, optimistic `hidden: false` on the
     cached item, toast, invalidate `['titles']` on settle.
   - Copy strings in `src/web/lib/copy.ts`.
   Commit `feat(web): hooks for surprise titles`. — files: `src/web/lib/api.ts`,
   `src/web/lib/copy.ts`, `src/web/pages/list_page.tsx`, `src/web/pages/add_page.tsx`
5. UI per the Design section: a way to add as surprise on the add page, a surprise marker
   and Reveal action on the adder's cards. Mutations disabled offline like the existing
   ones. Commit `feat(web): add and reveal surprise titles`. — files:
   `src/web/components/search_result_row.tsx`, `src/web/components/title_card.tsx`,
   possibly `src/web/pages/add_page.tsx`
6. Docs: update `CLAUDE.md` section 4 (hidden titles only in the random catalog), mark
   plan implemented and move to `done/`. — files: `CLAUDE.md`, this plan

Each step: `pnpm typecheck && pnpm lint`, commit, then the `CHANGELOG.md` follow-up commit.

## Design

Designed for the plan's current defaults (duplicate defuses, adder handles reveal/watched,
random stays uniform). Consistent with the existing screens: French copy with "tu", Shadcn
Button/Badge/AlertDialog, lucide icons, semantic tokens only.

### User flow
1. On the Add page, the member sees a "Mode surprise" toggle under the search field (off by
   default) → tapping it turns the mode on; a one-line explanation appears and every result's
   button changes from "Ajouter" to "Surprise" (gift icon, outlined).
2. They search and tap the button on a result → button shows "Ajout…", then the row becomes
   "Dans la liste"; toast "« X » ajouté en surprise" (action "Voir la liste").
3. The mode stays on while they stay on the page (to add several surprises in a row); it
   resets to off when they leave the Add page. Never persisted.
4. If TMDB has no IMDb id → error toast explaining why, with an "Ajouter normalement" action
   that adds it as a regular title in one tap.
5. In "À voir" (their device, themselves selected) the surprise card shows a "Surprise" badge
   on the poster and an extra full-width "Dévoiler" button → tapping it opens a confirmation
   dialog → "Dévoiler" confirms, toast "« X » n'est plus une surprise", badge disappears.
6. Marking a surprise "Vu" works as today; it moves to "Déjà vus" with the badge gone, and the
   toast says it is no longer hidden.
7. Other members see nothing different at any point (no badge, no count, no toast, no search state).

### Screens
#### Add page: surprise mode toggle
Wireframe (mobile, mode on):
```
+--------------------------------------+
| [Q] Un film, une série…          [x] |  <- existing Input, h-12
| [🎁 Mode surprise            (on) ]  |  <- toggle button, h-11
| Caché aux autres. Peut sortir dans   |  <- helper, only when on
| Stremio « Au hasard ».               |
+--------------------------------------+
| [poster] Titre du film     [🎁 Surprise]
|          2024 · Film                 |
| [poster] Autre titre       [🎁 Surprise]
+--------------------------------------+
```
- Layout: inside the existing sticky block in `src/web/pages/add_page.tsx` (the `div` with
  `sticky top-[calc(3.5rem+env(safe-area-inset-top))]`), below the input, `mt-2`. Toggle is
  left-aligned, `h-11` (44px). The helper `<p>` sits under it, `pt-2 text-sm
  text-muted-foreground`, only rendered while on. Same position at larger widths (column is
  already `max-w-2xl`); no layout change. Sticky block grows by about 3.5rem while the helper is
  shown; acceptable since results scroll under a solid `bg-background`.
- Why a page-level toggle and not a second button per row: a row is poster (56px) + text +
  a 112px button; a second 44px+ target would squeeze the title to nothing at 375px, and a
  per-row menu costs an extra tap for the normal add, which is the common action. A toggle
  keeps the normal add at one tap, and surprises at one toggle plus one tap.
- Components: existing `Button` (`src/web/components/ui/button.tsx`), no new primitive. The
  toggle is a `Button variant="outline"` with `aria-pressed`, `Gift` icon (lucide), label
  "Mode surprise". On state: `border border-primary bg-secondary text-foreground` (contrast
  safe on both themes) and a `Check` icon at the end instead of a visual switch. State
  is never conveyed by color alone: the Check icon and `aria-pressed` carry it.
- Row button (`src/web/components/search_result_row.tsx`): new prop `surprise: boolean`
  passed from `AddPage`. Off: unchanged (primary, `Plus`, "Ajouter"). On: `Button
  variant="outline"` with `border-primary`, `Gift` icon, label "Surprise", same `min-w-[7rem]`
  so rows don't shift. Pending and "Dans la liste" states are unchanged and identical for both
  modes (so a screenshot of the list never reveals which was used).
- Interactions: toggling is local React state in `AddPage` (`useState(false)`), no query
  involved. `add.mutate({ hit, addedBy: member, hidden: surprise })`. Mode is not changed by a
  successful add. Offline: toggle `disabled` along with the search input.
- Typography and color: `text-sm font-medium` as other buttons; helper `text-sm
  text-muted-foreground`; marker colors use `primary`, `border-primary`, `background`; no raw hex.

#### Title card: surprise marker and Reveal action (adder only)
Wireframe (card, two-column grid at 375px):
```
+-----------------+
| [👁‍🗨 Surprise]   |  <- Badge top-left on poster
|                 |
|     poster      |
|                 |
+-----------------+
Titre du film
2024 · Film
Ajouté par Léa
[ ✓ Vu      ][🗑]
[ 👁 Dévoiler    ]   <- only when item.hidden
```
- Marker: `Badge variant="outline"` (existing, `src/web/components/ui/badge.tsx`) as a child of
  `Poster`, `absolute top-2 left-2 bg-background/85 backdrop-blur`, icon `EyeOff size={12}
  aria-hidden`, text "Surprise". Same recipe as the existing "Pas dans Stremio" badge (which is
  bottom-left, so they never collide; a hidden title always has an IMDb id so both never show
  together anyway). Text color `text-foreground` on `bg-background/85` meets contrast in both
  themes. Add `title={copy.surpriseDesc}` for pointer users, but the information is also in the
  visible label, so touch users lose nothing.
- Reveal button: a second row under the existing actions. The existing
  `div.mt-2.flex.gap-2` stays; add below it, only if `item.hidden && !watchedTab`, a `Button
  variant="outline" className="w-full"` with `Eye` icon and "Dévoiler", `aria-label`
  `copy.revealAria(title)`, `disabled={!online}`. Full width, 44px high. Reason for a separate row:
  at 375px the card is about 165px wide, "Vu" + trash already take it, a third icon button would
  be an unlabeled mystery target. Wrap the two rows in one `div.flex.flex-col.gap-2` so spacing
  stays even. Larger widths: unchanged (grid just widens).
- Reveal confirmation: yes. Reveal is irreversible (no re-hide) and affects the other person
  (the surprise is spoiled and it enters their list and Stremio "À voir"). New component
  `RevealDialog` in `src/web/components/reveal_dialog.tsx`, built from the same `AlertDialog`
  primitives as `RemoveDialog` (same structure, trigger lives inside the component so focus
  returns to the "Dévoiler" button on cancel). Action button is the default (not destructive)
  variant. No confirmation for "Vu": it's an existing one-tap action with Undo toast.
- Interactions: confirm calls `useRevealTitle().mutate({ id, title })`, optimistic: the badge
  and button vanish immediately (card stays in place, no leaving animation). On error the
  optimistic change rolls back and an error toast shows. "Vu" on a surprise: existing `leaving`
  fade, optimistic move, `hidden` forced to `false` on the cached copy. The Undo action in the
  watched toast puts it back to "À voir" as a normal visible title (do not restore
  `hidden: true`; the server doesn't either).
- Watched tab: no badge and no Reveal action (a watched title is never hidden).
- Others' view: `hidden` is never `true` in their data, so none of this renders.

### States
- Loading: list: existing `TitleGridSkeleton` (no hint of surprises). Add page: existing result
  skeletons; the toggle is available immediately and is not part of any fetch. Reveal button
  pending: dialog closes on confirm, optimistic update, no spinner needed.
- Empty: unchanged. If a member only has surprises, "À voir" shows them (not empty). If another
  member has no visible titles, they see the usual empty state even if surprises exist: no
  mention. No new empty states.
- Error:
  - Add generic failure: existing `addToastError`.
  - 422 (no IMDb id): `toast.error` with copy `addToastNoImdb(title)`, 8 s duration, with
    action "Ajouter normalement" that calls `add.mutate({ hit, addedBy: member, hidden: false })`.
  - Reveal failure: `toast.error(copy.errorReveal(title))`, optimistic change rolled back.
  - 409 on a surprise (title already visible): existing `addToastExists`. Do not word it
    differently for hidden titles: the adder re-adding their own hidden title also gets
    `addToastExists`, which is accurate for them.
- Success:
  - Surprise added: `copy.addToastSurprise(title)` ("ajouté en surprise") with action "Voir la
    liste"; the toast only appears on the adder's device.
  - Defused duplicate (200): same toast as a normal add, `addToastAdded`, because the second
    person did not ask for a surprise or, if they did, the toast must not reveal that it existed
    hidden. Rule for the builder: the success toast depends only on the requested `hidden` value
    when the response is `201`; on `200` always use `addToastAdded`. (A second person who also
    requested a surprise and hit a defuse therefore sees "ajouté à À voir" and the row shows
    "Dans la liste": correct, since the title is now visible.)
  - Revealed: `copy.toastRevealed(title)`, no Undo (not reversible).
  - Watched on a surprise: `copy.toastWatchedRevealed(title)`; normal Undo action kept.
- Slow network / offline: search is already disabled offline with the existing
  `addOfflineTitle` state, and the toggle is disabled with it. On the list, "Dévoiler" is
  `disabled={!online}` like the other card actions; the cached list (keyed per member) shows
  surprises for the member who had them cached. Switching member while offline with nothing
  cached falls into the existing `offlineNoCacheTitle` state. Slow search keeps `addSlow`.
- No-leak checklist for the builder:
  - No count, badge, toast or placeholder anywhere on another member's device: counts in
    `list_page.tsx` come from `data.length` of the member-scoped query; do not add a separate
    "hidden" count.
  - Search: another member's hidden title shows a normal "Ajouter" button (server), and the
    surprise toggle state is not shown in the row after adding ("Dans la liste" only).
  - Do not use `placeholderData: keepPreviousData` across a member change for `useTitles` or
    `useSearch`: when the picker switches from A to B the previous member's rows (surprises
    included) must not linger. Keying by member handles it as long as previous data is only kept
    for the same member (for search, the existing `isPlaceholderData` dimming should apply to
    query-string changes only). A brief skeleton on switch is the right trade-off.
  - Toasts, `document.title` and aria-live text never contain surprise titles for anyone but the
    adder.

### Copy
| Key | Text |
|-----|------|
| surpriseToggle | Mode surprise |
| surpriseToggleHelp | Caché aux autres. Peut sortir dans Stremio « Au hasard ». |
| surpriseOnAnnounce | Mode surprise activé : les ajouts seront cachés aux autres. |
| surpriseOffAnnounce | Mode surprise désactivé. |
| addSurpriseButton | Surprise |
| addSurpriseButtonAria | (title) => `Ajouter « ${title} » en surprise` |
| addToastSurprise | (title) => `« ${title} » ajouté en surprise` |
| addToastNoImdb | (title) => `« ${title} » ne peut pas être une surprise : il n'a pas de fiche IMDb.` |
| addToastNoImdbAction | Ajouter normalement |
| surprise | Surprise |
| surpriseDesc | Caché aux autres. Peut sortir dans Stremio « Au hasard ». |
| reveal | Dévoiler |
| revealAria | (title) => `Dévoiler « ${title} » aux autres` |
| revealTitle | (title) => `Dévoiler « ${title} » ?` |
| revealBody | Il apparaîtra dans la liste et dans Stremio pour tout le monde. Tu ne pourras plus le cacher. |
| revealCancel | Annuler |
| revealConfirm | Dévoiler |
| toastRevealed | (title) => `« ${title} » n'est plus une surprise` |
| errorReveal | (title) => `Impossible de dévoiler « ${title} ». Réessaie.` |
| toastWatchedRevealed | (title) => `« ${title} » est dans Déjà vus et n'est plus caché` |

Existing keys reused unchanged: `addButton`, `addAdding`, `addInList`, `addToastAdded`,
`addToastView`, `addToastExists`, `addToastError`, `errorUpdate`, `toastUndo`, `offlineBanner`.

### Accessibility
- Toggle: a real `<button aria-pressed>` with a static name "Mode surprise" (the label never
  changes with state). Focus ring comes from `Button`. A visually hidden `role="status"` region
  announces `surpriseOnAnnounce` / `surpriseOffAnnounce` on change; the visible helper text is
  linked with `aria-describedby`.
- Row buttons in surprise mode keep a per-title accessible name (`addSurpriseButtonAria`) so
  screen readers differ between modes; the visible label "Surprise" is part of that name.
- State is never conveyed by color alone (Gift vs Plus icon, "Surprise" vs "Ajouter", Check
  on the toggle, "Surprise" text on the badge). All text uses semantic tokens that already
  pass contrast in light and dark; the badge sits on `bg-background/85` with
  `text-foreground`.
- `RevealDialog` uses Radix `AlertDialog` like `RemoveDialog`: focus trapped, Escape closes,
  focus returns to the "Dévoiler" button; initial focus on Cancel (Radix default) so Enter does
  not reveal by accident. After a confirmed reveal the button disappears, so move focus to the
  card's "Vu" button (or the `h3`, `tabIndex={-1}`) to avoid focus dropping to `body`.
- Icon-only buttons: none added. Decorative icons `aria-hidden`.
- `prefers-reduced-motion`: no new animations; the existing `motion-reduce:` classes and the
  skipped fade on "Vu" apply.
- Touch targets: toggle `h-11`, row button and "Dévoiler" use default `Button` height (44px,
  as the existing "Ajouter" and "Vu" buttons).

### Questions
- Q1 (duplicate defuses the surprise): designed as defaults. If the user prefers "stay hidden,
  tell the second person nothing", the second person's `200` must look like a normal add yet the
  title won't appear in their list; that creates a dead "Dans la liste" row with nothing to
  open. Needs a decision, and I'd recommend keeping the default.
- Q2 (adder handles watched/reveal): designed as defaults, with "Dévoiler" and "Vu" only on the
  adder's card. If everyone should be able to mark a picked surprise watched, the card would need
  a shared signal and a visible state for the others, which contradicts "nothing differs for
  others"; the design would have to add a new marker for non-adders. Not recommended.
- Q3 (weighted random): no UI impact. The helper copy "peut sortir" is deliberately neutral so it
  stays true either way.
- New, for the user: should the poster of a surprise be blurred or hidden on the adder's own
  list (so a partner glancing at the phone doesn't spot it)? I did not add it (not in the plan).
  Adder's own cards currently show the full title and poster plus the badge.
- New, for the planner (data impact): the 422 toast's "Ajouter normalement" action needs
  `useAddTitle` to expose a retry with `hidden: false`; no API change needed. The search hit
  also doesn't expose whether a TMDB result has an IMDb id before adding, so the 422 only shows
  after the tap (acceptable; no extra TMDB calls per CLAUDE.md).
- New, for the planner: `useRevealTitle` and the Undo behavior on watched imply that unmarking
  watched leaves a previously hidden title visible. This matches the plan, but the Undo toast
  could surprise the adder (their surprise is now public). The `toastWatchedRevealed` copy states it.

## Risks and open questions
- Soft visibility: switching the member picker to the adder's name shows their
  surprises. Accepted by design; there are no accounts.
- Random is a uniform pick over all unwatched titles of that type, so with a long list a
  surprise comes up rarely. Watching it in Stremio doesn't sync anything back, and the
  viewer can't see it in the web app to mark it watched; only the adder can (see question 2).
- Open questions:
  1. Duplicate rule: OK that someone else adding the same title defuses the surprise
     (it becomes a normal, visible title)? Alternative: keep it hidden and tell the second
     person nothing.
  2. Since only the adder can see a surprise in the web app, the person who watched it
     can't mark it watched. OK that the adder marks it (or reveals it) afterwards, or
     should hidden titles also show to everyone as soon as they've been picked? (We have no
     signal for that from Stremio, so the simple answer is "the adder handles it".)
  3. Should surprises be weighted in the random pick (e.g. 50 % chance to pick a hidden
     title when one exists), or stay uniform as planned?

## How to verify
1. `pnpm dev`, two browsers (or a private window) with members A and B selected.
2. A adds a movie as surprise: A sees it in "À voir" with the marker and the count includes
   it; B's list, counts and search ("Ajouter" button, not "Dans la liste") show nothing.
3. `curl /<token>/stremio/catalog/movie/to_watch.json`: the surprise is absent.
   `random.json` (repeat a few times, past the 60 s cache or in dev): it shows up.
4. In Stremio (installed addon): the "Popcorn · Au hasard" row eventually shows the
   surprise; "Popcorn · À voir" never does.
5. A adds a title with no IMDb id as surprise: 422 toast, nothing inserted.
6. B adds the same movie A hid: B gets the normal "added" toast; both lists now show it
   without the marker; it appears in Stremio `to_watch`.
7. A adds another surprise, taps Reveal: visible for B. Another one, marks watched: it moves
   to "Déjà vus" for both and appears in Stremio `watched`; unmarking keeps it visible.
8. Optimistic flows still work and roll back on error (stop the server, try mark watched,
   remove, reveal).
9. Wrong token: `curl -i /<wrong>/api/titles?member=A` and `/<wrong>/api/titles/1/reveal`
   (POST) return a bare 404.
10. Offline (PWA, devtools offline): list opens from cache for the current member;
    add, reveal, mark watched and remove are disabled.
11. Existing DB: after the migration, every existing title is visible and unchanged.

## Decisions (user, 2026-10-31)
1. A duplicate add by another member defuses the surprise: it becomes a normal visible title (200).
2. Only the adder marks a surprise watched or reveals it.
3. Random stays a plain random pick (no weighting toward surprises).
4. No poster blur on the adder's own surprise cards.
