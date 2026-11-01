# Remote MCP server with OAuth

Status: approved
Approved by: the user, 2026-11-01 ("ok", then "just do everything")

## Decisions

The user chose these on 2026-11-01. Where a section below disagrees, this list is the current decision.

1. **Public `/mcp` with root-level OAuth.** The endpoint is `${SITE_URL}/mcp` with no secret in its URL, and the app is its own authorization server. Rejected: an issuer under the gate at `https://host/<token>`, because the secret stays in the connector URL.
2. **CLAUDE.md exception** as worded under "Proposed CLAUDE.md edit".
3. **Clients for now: Claude and Gemini CLI.** No Google callback host goes on the allowlist until a specific Google product needs one.
4. **Consent secret: a separate `MCP_CONNECT_CODE`, not `APP_TOKEN`.** Lower sections that name `APP_TOKEN` as the consent secret (form, ticket, grant tag) predate this choice:
   - `APP_TOKEN` is not accepted by any OAuth route, and the gate is unchanged. Rotating `APP_TOKEN` doesn't affect OAuth grants.
   - `env.ts`: `MCP_CONNECT_CODE` is optional, minimum 16 characters. If it's unset, the server still starts and the gated app works normally, while `/oauth/authorize` renders the invalid-request page and logs one warning. It never falls back to `APP_TOKEN`.
   - `isAppToken` becomes `isConnectCode` in `src/server/token.ts`, constant-time and not used by the gate.
   - The form field is `connect_code`. The ticket HMAC key is `MCP_CONNECT_CODE`.
   - `app_token_tag` becomes `connect_code_tag`, `sha256('popcorn-grant|' + MCP_CONNECT_CODE)`. Rotating the code disconnects every grant.
   - Use the copy from the `MCP_CONNECT_CODE` row of "Adapting to the open decisions".
   - Add the variable to `mise.toml.example` and `docker-compose.portainer.yml`. The verify script uses it in place of `APP_TOKEN` for consent, and also checks that the form refuses `APP_TOKEN`.
5. **Attribution: each connection is bound to a member at consent**, replacing `addedBy` and `list_members`. Removing the member cascades the grant away, so the next call gets a 401.
6. **Redirect allowlist: loopback plus `claude.ai` and `claude.com` only.**
7. **Surprises: MCP never returns, changes or creates a hidden title.** There is no `surprise: true`. A model can still defuse a surprise by adding that title, same as the web.
8. **Lifetimes: access 1 h, refresh 30 days sliding, 90-day absolute cap.**
9. **Revocation: gated `/api/connections` API, no UI.** The connection-limit copy stays as designed.
10. **Authorize page: dark only.** Double submits are accepted. The connection limit is also checked at unlock.
11. **No `robots.txt`.**

## Goal
Let members read and edit the shared watchlist from MCP clients: claude.ai custom connectors, Claude
Code, and Gemini CLI, with Google products in scope via OAuth. Mirrors lepetitmonde's stateless
Streamable HTTP server and its OAuth 2.1 flow (discovery, dynamic client registration, PKCE S256,
rotating refresh tokens).

## Out of scope
- User accounts or per-person passwords. Everyone with the consent secret can connect as any member,
  which matches the web's soft identity.
- Client ID Metadata Documents, OIDC, `client_credentials`, custom-scheme redirects.
- CORS on the OAuth routes. Required clients call them from servers or Node, so CORS stays Stremio-only.
- MCP resources, prompts, subscriptions, sessions, listen streams.
- Rate limiting the existing `/<token>` gate (see Risks).

## Current state
- **Reference, MCP**: `/root/lepetitmonde/src/app/api/mcp/route.ts`: bearer check, then a per-request
  `createMcpHandler` from `mcp-handler` 2.3.0 over `@modelcontextprotocol/server` 2.4.0. `mcp-handler`
  needs `next` as a peer, so Popcorn uses the SDK's own `createMcpHandler`.
- **Reference, OAuth**: `src/utils/oauth/{config,metadata,clients,tokens,pkce,redirect-uri,authorize-request,http}.ts`,
  `src/app/api/oauth/{register,token,revoke}`, `src/app/.well-known/*`, `src/app/(auth)/oauth/authorize/`,
  `src/utils/rate-limit.ts`, `src/utils/oauth-limiters.ts`. About 1,270 lines. Port the logic, drop the
  Supabase and CORS parts.
- **Gate**: `src/server/token.ts`, bare 404 on a wrong token. `src/server/app.ts` mounts
  `app.route('/:token', gated)`, and `AppType` is `typeof gated`.
- **Headers** (`app.ts`): global `secureHeaders` with `Referrer-Policy: no-referrer`, a CSP with no
  `form-action`, and Hono's default `Cross-Origin-Opener-Policy: same-origin`.
- **Data**: SQLite, `foreign_keys = ON` (`src/server/db/index.ts`), last migration `drizzle/0003_*`.
  `members` has no delete or rename route. `titles.added_by` is a text name.
- **Logic is inside route handlers** in `src/server/routes/api.ts`.
- **Deployment**: `docker-compose.portainer.yml` publishes port 8787 on the host, so `cf-connecting-ip`
  can be forged by anything that reaches that port directly.
- **Tests and docs**: no test suite, no README. `pnpm typecheck` and `pnpm lint` are green today.
- **Drift**: `LOG_LEVEL` is in `src/server/env.ts` but not in CLAUDE.md's env list. Unrelated; left alone.

## What Google clients need
"Google" isn't one client, and the user didn't say which one they mean.

| Product | Auth it needs | Basis | Works with this design? |
|---|---|---|---|
| **Gemini CLI** | OAuth optional. Starts it only on a 401; also accepts `headers`, or no auth | Source on `main`: `mcp-client.ts`, `oauth-utils.ts`, `oauth-provider.ts`, `oauth-flow.ts` (read, not run) | Yes: 401, metadata, DCR as a public client, PKCE, `/mcp auth popcorn` |
| **Gemini Enterprise** custom MCP | Offers OAuth 2.0 **or** "No authentication". No DCR: client ID, secret and URLs are entered by hand. Redirect `https://vertexaisearch.cloud.google.com/oauth-redirect` | Google Cloud docs | Probably. Create the client once via `curl` to `/oauth/register` (confidential), add the host to the allowlist, tick "Enable PKCE". Paid product, org-policy overrides needed |
| **Gemini API** Interactions remote MCP | `url` plus static `headers`. No OAuth flow | `ai.google.dev` function-calling docs | **No.** It would need a long-lived static bearer, which this design doesn't issue |
| **Gemini app** (web, mobile) | Unknown | Could not verify. The release notes have no MCP or connector mention, my guessed help-center URLs returned 404, and search engines didn't return usable results | Unknown |

**So the statement "Google will require OAuth" isn't confirmed for any product I could check.** It may
still be true of the consumer Gemini app or a newer product. Public `/mcp` with OAuth stands on its own
merits either way: no secret in connector URLs, per-connection revocation, and tokens scoped to `/mcp`.

Client requirements found in the source, which the design below meets:
- **Gemini CLI**:
  - The PRM must be same-origin, and its `resource` must equal the server URL.
  - It registers with `token_endpoint_auth_method: none`, `redirect_uris: ['http://localhost:<port>/oauth/callback']`.
  - The port is OS-assigned by default, though its older docs say 7777, so loopback matching must ignore the port.
  - It rejects a callback without `iss` when metadata advertises `authorization_response_iss_parameter_supported: true`. Popcorn advertises it and always sends `iss`.
  - OAuth endpoints resolving to private IPs are blocked, so the public hostname must not resolve to a LAN address on that machine.
- **Claude** (`claude.com/docs/connectors/building/authentication`):
  - A 401 with a `resource_metadata` pointer starts sign-in, and `resource` must match the entered URL exactly.
  - It uses DCR when CIMD isn't advertised.
  - Redirects are `https://claude.ai/api/mcp/auth_callback` and a loopback on any port for Claude Code.
  - Discovery and token endpoints have 10 s, refresh 30 s.

## Approach
1. Extract the watchlist logic into `src/server/watchlist.ts`.
2. Port lepetitmonde's OAuth core to `src/server/oauth/`, on Drizzle.
3. Mount one `oauth` Hono sub-app **before** the gate: `app.route('/', oauth); app.route('/:token', gated);`.
   Each route is an exact path and method. Anything else falls through to the gate, whose `:token` param
   is then `mcp`, `oauth` or `.well-known`, which can't equal `APP_TOKEN` (`env.ts` requires 16+ chars).
   So it's still a bare 404.
4. `/mcp` verifies the bearer, then runs a per-request handler with the member in a closure, as
   lepetitmonde does:

```ts
// src/server/routes/oauth.ts, on the /mcp route, after the bearer check
const handler = createMcpHandler(
  () => {
    const server = new McpServer({ name: 'popcorn', version: '1.0.0' }, { instructions: instructionsFor(member.name) });
    registerTools(server, { memberName: member.name, grantId });
    return server;
  },
  { legacy: 'stateless', maxSubscriptions: 0, maxRequestBodySize: 64 * 1024 },
);
return handler.fetch(c.req.raw);
```

## Tools
Five tools. English descriptions, JSON text via `ok()`, ISO 8601 timestamps, no poster URLs. Titles are
in French (TMDB `fr-FR`). `instructions` tell the model it's connected as `<member>` and to search first.

| Tool | Input | Returns | Annotations |
|---|---|---|---|
| `search_titles` | `query` (trim, 2–100) | up to 20 `{ tmdbId, type, title, year, inList }` | `readOnlyHint` |
| `list_titles` | `status?`, `type?`, `includeOverview?` (default false) | `{ id, tmdbId, type, imdbId, inStremio, title, year, genres, runtime, addedBy, status, addedAt, watchedAt, overview? }[]`, newest first | `readOnlyHint` |
| `add_title` | `tmdbId`, `type` | `{ id, tmdbId, type, title, year, imdbId, inStremio, status }` | `destructiveHint: false` |
| `set_title_status` | `id`, `status` | same as `add_title` plus `watchedAt` | `destructiveHint: false`, `idempotentHint` |
| `remove_title` | `id` | `{ removed: true }` | `destructiveHint: true` (description: can't be undone) |

- `inStremio` is `imdbId !== null`. The `add_title` description says a title without one won't appear in Stremio.
- Left out: `reveal_title` and a surprise flag (decision 6); `pick_random` (Stremio's random includes
  surprises by design); `add_member`; `list_members` (no longer needed); any config tool
  (`stremioManifestUrl` contains the token).

### Shared logic: new `src/server/watchlist.ts`
Moved from `api.ts` with REST behaviour, statuses and error strings unchanged:

| Function | From | Signature |
|---|---|---|
| `parseGenres`, `toDto`, `TitleDto` | helpers | as today |
| `memberName`, `titleId` | zod schemas | `memberName` as today; `titleId = z.number().int().positive()` |
| `listTitles` | `GET /titles` | `({ status?, type?, member? }) => TitleDto[]` (`type` is new) |
| `addTitle` | `POST /titles` incl. `defuse` and race handling | `({ tmdbId, type, addedBy, hidden }) => Promise<Result<{ title: TitleDto; created: boolean }>>` |
| `setTitleStatus` | `PATCH /titles/:id` | `(id, status, scope) => Result<TitleDto>` |
| `removeTitle` | `DELETE /titles/:id` | `(id, scope) => Result<void>` |
| `searchTitles` | `GET /search` | `(q, member?) => Promise<Result<SearchResult[]>>` |

- `type Result<T> = { ok: true; value: T } | { ok: false; code: WatchlistError }`, codes `unknown_member`,
  `tmdb_not_found`, `tmdb_unreachable`, `already_in_list`, `no_imdb_id`, `not_found`.
- `scope: 'all' | 'visible'` is a required argument. `'visible'` adds `eq(titles.hidden, false)`. REST
  passes `'all'`, MCP passes `'visible'`.
- REST maps codes with explicit branches and literal statuses, so `AppType` inference doesn't change.
  `addTitle` keeps 201 vs 200, which `useAddTitle` reads.
- Stay in `api.ts`: `onInvalid`, `/config`, members routes, `/titles/:id/reveal`. `GET /members` still
  serves the web; the consent page reads `members` directly.

## Hidden titles
How they work today: `GET /api/titles` and `/api/search` show hidden rows only when `member` equals
`added_by`. With no `member`, they're excluded and `inList` is false. In Stremio, only `random` includes
them. By-id REST routes don't check `hidden`. `POST` defuses another member's hidden row; your own gets 409.

MCP rules (decision 6):
1. `list_titles` and `search_titles` never pass `member`, even though the grant now knows it. `hidden`
   appears in no output, and no count of hidden rows exists.
2. `set_title_status` and `remove_title` use `scope: 'visible'`. A hidden id gets the same "not found"
   as a missing id. The REST `PATCH` would return and reveal it, and ids are guessable.
3. `add_title` hard-codes `hidden: false`.
4. **Defuse is kept.** Adding a title another member hid makes it visible, same as the web. The response
   leaves out `addedBy` and `addedAt`, and `created` isn't exposed, so a defused add looks like a new one.

Accepted leaks: adding your own hidden title returns "Already in the list" while `list_titles` doesn't
show it (harmless, it's yours). Gaps in `id` could hint at hidden rows, but deletions cause gaps too. This
protects against accidental spoilers, not against someone holding `APP_TOKEN`.

To confirm: a model can defuse a surprise on its own, for example with "add these 5 films". Refusing would
spoil it, so the existing rule stays.

## Attribution
- Consent's second step lists members. The picked `member_id` is stored on the grant, and `add_title`
  writes that member's canonical name to `added_by`.
- The grant binds by id, resolved on each `/mcp` call and refresh with an inner join.
- **Member removed later**: `oauth_grants.member_id` has `ON DELETE CASCADE`, so the grant goes with the
  member. A row deleted with foreign keys off leaves an orphan that fails the join. Either way the next call
  gets a 401 and the client re-authorizes, picking a member. Titles keep their `added_by` text. There's no
  delete-member route today, so this only happens by manual DB edit.
- **No members yet**: consent says to add yourself in the web app first, and can't approve.
- **Limit**: the binding is what the person chose at consent, not proof of identity.

## Data and migrations
New migration `drizzle/0004_*`, from `pnpm db:generate`. **Additive only**: two `CREATE TABLE`s plus
indexes, no change to `titles` or `members`. The builder checks the SQL has nothing else. Applied at start;
safe for existing rows.

`oauth_clients`:
- `id` (text PK, UUID), `client_name`, `redirect_uris` (JSON text), `auth_method` (`none | client_secret_post | client_secret_basic`), `client_secret_hash` (nullable), `created_at`.

`oauth_grants` (one row per connection):
- `id` (text PK, UUID)
- `client_id` (FK, cascade), `member_id` (FK, cascade)
- `resource`, `scope`, `redirect_uri`, `code_challenge`
- `code_hash` (unique), `code_expires_at`, `code_used_at`
- `access_token_hash` (unique), `access_expires_at`
- `refresh_token_hash` (unique), `previous_refresh_token_hash` (indexed), `refresh_expires_at`
- `app_token_tag`
- `created_at`, `last_used_at`, `revoked_at`

Tokens and lifetimes (decision 7):
- Codes, access and refresh tokens are 32 random bytes, base64url, with prefixes `pcc_`, `pca_`, `pcr_`.
  **Only SHA-256 hashes are stored.**
- Code 2 min and single use; reuse revokes the grant. Access 1 h. Refresh 30 days sliding, rotated each use,
  capped at 90 days from grant creation.
- Reusing the previous refresh token revokes the grant. A client that loses a refresh response must
  reconnect, as in lepetitmonde.
- `last_used_at` is written at most every 5 minutes.
- Cleanup, no cron: on each registration and approval, delete clients older than 24 h with no grant, and
  grants that are revoked, or past their refresh or code expiry.

### Revocation and token rotation
- **One connection**: gated `DELETE /<token>/api/connections/:id`. Next call gets a 401.
- **By the client**: `POST /oauth/revoke` (RFC 7009).
- **Automatically**: unused for 30 days, 90-day cap, member removed.
- **Everything**: rotating `APP_TOKEN`. `app_token_tag` is `sha256('popcorn-grant|' + APP_TOKEN)`, set at
  approval and checked on each `/mcp` call and refresh. Without it, grants would outlive the rotation, and a
  leaked `APP_TOKEN` could have minted a grant that survives it.

**The earlier token-rotation downside is only partly resolved.**
- Resolved: revoking a connection no longer needs rotation; connector URLs hold no secret, so third parties
  don't store full-app access; an access token reaches `/mcp` only, never the web app or `/api/titles?member=`.
- Not resolved: rotating `APP_TOKEN` after a leak still breaks installed PWAs and Stremio installs, and now
  also forces each connector to sign in again (without being re-added). `APP_TOKEN` also gets typed into a
  public page, which is new exposure. Decision 3's alternative would separate these.
- `app_token_tag` is an unsalted hash, so a stolen DB allows offline guessing of a weak `APP_TOKEN`. The
  template's `openssl rand -hex 24` makes that infeasible.

## API
On the `oauth` sub-app, mounted before the gate. Issuer is `new URL(env.SITE_URL).origin`, never `Host` or
`X-Forwarded-*`. Resource is `${issuer}/mcp`.

| Route | Purpose | Responses |
|---|---|---|
| `ALL /mcp` | MCP Streamable HTTP, stateless | 401 with `WWW-Authenticate`, 429; with a valid token: 200 SSE, 202, 400, 405 (GET/DELETE), 406, 413 |
| `GET /.well-known/oauth-protected-resource` and `/mcp` suffix | RFC 9728: `resource`, `authorization_servers: [issuer]`, `scopes_supported: ['mcp']`, `bearer_methods_supported: ['header']` | 200, `max-age=300` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: endpoints, `code`, `authorization_code` + `refresh_token`, `S256`, the three auth methods, `iss` supported true, CIMD false | 200, `max-age=300` |
| `POST /oauth/register` | RFC 7591, JSON, 8 KiB cap | 201, 400 `invalid_redirect_uri` or `invalid_client_metadata`, 413, 429 |
| `GET /oauth/authorize` | Consent step 1 (HTML) | 200; 400 error page (bad client or redirect, never redirects); 303 with `error` otherwise |
| `POST /oauth/authorize` | Form: original params plus `action` (`unlock`, `approve`, `deny`) | HTML 200 or 401, 303 to client, 403, 429 |
| `POST /oauth/token` | Form, 8 KiB cap, `no-store` | 200, 400 `invalid_grant` etc., 401 `invalid_client`, 429 |
| `POST /oauth/revoke` | RFC 7009, whole grant | 200 even for unknown tokens, 401, 429 |

Gated additions, chained on `api` in `src/server/routes/api.ts` so they're in `AppType`:
- `GET /api/connections` returns `{ id, clientName, memberName, createdAt, lastUsedAt, refreshExpiresAt }[]`, non-revoked only.
- `DELETE /api/connections/:id` (`z.uuid()`) returns `{ ok: true }` or 404.

Existing REST routes are unchanged.

### Consent flow
1. `GET` validates everything (repeated params rejected, as in `authorize-request.ts`). It shows the client
   name, where it returns to, and the secret field. **No member names are shown before the secret.**
2. `POST action=unlock` with `app_token`: failure limiter, then constant-time compare. On success, renders
   the member picker with a `ticket`.
3. `POST action=approve` with `ticket` and `member_id`: re-validates all params from the form, inserts the
   grant, and returns 303 to `redirect_uri` with `code`, `state`, `iss`.
4. `POST action=deny` returns 303 with `error=access_denied`.

`ticket` is `<expMs>.<HMAC-SHA256(APP_TOKEN, 'consent|exp|client_id|redirect_uri|code_challenge|resource')>`,
10-minute TTL, constant-time compare. It needs no session or storage, and it's bound to the exact request.
Scope is ignored, and every grant gets `mcp`, as in the reference (clients send extras like `offline_access`).

## Access and security
**New public surface.** This is the fixed list in the proposed CLAUDE.md edit; everything else stays bare 404.

- **Bare 404 preserved**: confirmed by a local probe with this mount order. Wrong methods, `/oauth/nope`,
  `/.well-known/nope`, `/mcp/x`, `/` and a wrong token all return 404 with an empty body, and the gated app
  still works. The cost: `/mcp` and the metadata now reveal an MCP server exists at this host, which the
  bare-404 design used to hide. Metadata carries no `resource_name`, but the consent page does say Popcorn.
- **`/mcp` 401**: `WWW-Authenticate: Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource/mcp", scope="mcp"`, adding `error="invalid_token"` when a token was sent. Body `{ "error": "unauthorized" }`. Token only from the `Authorization` header.
- **Audience**: `resource` on authorize and token must equal `${issuer}/mcp` when sent, else `invalid_target`.
  Stored on the grant and checked on every call against the current `SITE_URL`.
- **`APP_TOKEN` form**:
  - Export `isAppToken(given)` from `src/server/token.ts` and use it in both the gate and the form, so there's
    one constant-time compare.
  - Never log the body. Field `type="password"`. Pages send `Cache-Control: no-store`. The value is never echoed.
  - Limiter: 5 failures per 15 min per `cf-connecting-ip`, **and** 20 failures per hour globally, because that
    header can be forged via the published host port. Checked before comparing; success doesn't count. In-memory
    (`src/server/rate_limit.ts`, ported), reset on restart. A global lockout blocks only new connections; the web,
    Stremio and existing connections are unaffected.
- **`redirect_uri`**: at registration, keep only `http` on a loopback host or `https` on an allowlisted host, with
  no fragment or userinfo; drop the rest and reject if none remain. At authorize, exact match, except loopback may
  differ by port (RFC 8252). Port `isAllowedRedirectUri` and `redirectUriMatches`, adding the allowlist. Bad client or
  redirect gets an error page, never a redirect.
- **PKCE**: S256 required; `plain` or missing is rejected.
- **CSRF on consent**: there's no cookie or session, so a forged POST has no ambient credential and would need the
  secret or a valid `ticket`. Defence in depth: Hono `csrf()` on `POST /oauth/authorize` **only**, never on
  `/oauth/token` or `/oauth/revoke`, which are form-encoded calls from non-browsers.
  - **Trap**: under `Referrer-Policy: no-referrer`, the Fetch spec has browsers send `Origin: null` on POSTs, so
    origin checks can't pass. `csrf()` allows the request if either check passes, so `Sec-Fetch-Site: same-origin`
    is what lets it through. The probe confirmed same-origin passes and cross-site or missing headers get 403.
- **Phishing**: the main risk of open DCR is a link to the real page that returns the code to an attacker. The
  allowlist closes it (decision 5). The consent page shows the return host, and approval is never automatic.
- **DCR abuse**: 10 per hour per IP, 50 per day globally, 8 KiB body, at most 10 redirect URIs, sanitized client name
  (control and bidi characters stripped, 100 chars), HTML-escaped on render, at most 100 client rows (else 503), stale
  rows swept. A client row grants nothing without consent. At most 20 active grants.
- **Other limits** (from `oauth-limiters.ts`, `mcp-limiters.ts`): token 60 per 15 min and 20 failures per 15 min per IP;
  revoke 30 per min; `/mcp` 20 failed auths per 15 min per IP and 120 calls per min per grant.
- **Client auth**: `none`, `client_secret_post`, `client_secret_basic`, hashed secret, constant-time compare, as in
  `clients.ts`. Confidential support is needed for Gemini Enterprise and any confidential DCR client.
- **`Origin` on `/mcp`, a spec deviation**: the transport spec says servers MUST validate it. Not enforced, same as
  lepetitmonde: auth is a bearer header browsers never attach on their own, and Claude's backend `Origin` is unverified.
- **Logging**: log ids and enums only. Never codes, verifiers, tokens, secrets, form bodies or `Authorization`. Per
  the reference's comment, only log param names that look like names, since a malformed body can parse into a huge key.
  The request logger already logs method and status only.
- **Tool output**: the SDK copies thrown error text into tool results (confirmed by probe), so every handler goes
  through `run()`, which returns fixed text only. Tools read only DB rows and TMDB. `add_title` etc. use `memberName`
  from the closure.

### CSP and headers on the consent page
Checked against `app.ts`:
- **Native form POST then 303 to the client works.** The CSP has no `form-action`, and it doesn't fall back to
  `default-src`. Browsers apply `form-action` to redirects after a submit, which is why lepetitmonde navigates with JS.
  **Don't add `form-action`** to the global CSP; a comment in `app.ts` should say why. `secureHeaders` also runs after
  the route and would overwrite a per-route CSP.
- `default-src 'self'` blocks inline scripts, so the page uses none. `style-src 'unsafe-inline'` allows an inline
  `<style>`. `frame-ancestors 'none'` and `X-Frame-Options: DENY` cover clickjacking.
- **COOP**: Hono's default `same-origin` would sever a popup from its opener. lepetitmonde sends no COOP, so its flow
  doesn't show this. If claude.ai opens consent in a popup, it could lose the window. Delete the header on
  `/oauth/authorize` with middleware registered **before** `secureHeaders`. Probe confirmed this works.
- `Referrer-Policy: no-referrer` keeps the code and params out of referrers.

### Validation and tool errors
- Zod on all inputs, reusing `TITLE_TYPES`, `TITLE_STATUSES`, `titleId`; `tmdbId` as `z.number().int().positive()`. `state` up to 4096 (Google sends long ones, per the reference).
- `run(tool, fn)` from the reference's `shared.ts`: logs, returns `ok(value)`, and on anything thrown returns `isError` with `The request failed.`
- Expected errors are `isError: true`, HTTP 200: `tmdb_not_found` "Title not found on TMDB."; `tmdb_unreachable` "Could not reach TMDB. Try again."; `already_in_list` "Already in the list."; `not_found` "Title not found. Use list_titles."; `unknown_member` and `no_imdb_id` can't occur, so they get the generic text.
- Zod failures come from the SDK as `isError` text with the arguments only. Unknown tool: JSON-RPC `-32602`.

### Notes that no longer apply
- **SPA fallback**: no change. No route is added under `/<token>`, so the regex stays `api|stremio`. `/<token>/mcp` is just
  an SPA path with no route.
- **Service worker**: no change. Its scope is `/<token>/`, so it can't control `/mcp`, `/oauth/*` or `/.well-known/*`.
  `/api/connections` isn't in the network-first pattern, so it's never cached.
- **Dev proxy**: no change. OAuth is tested directly against the server port.
- **`AppType`**: `/mcp` and OAuth are outside `gated`, so it only gains the two connections routes.

### Proposed CLAUDE.md edit
**Approved by the user and applied directly to `CLAUDE.md` by the coordinator, so the builder leaves it alone.**

Section 3, replace these two lines:

> - Everything is mounted under `/:token`, behind the single gate middleware in `src/server/token.ts` (constant-time compare). Any other path returns a bare 404.
> - Never add a route outside the gated sub-app.

with:

> - Everything is mounted under `/:token`, behind the single gate middleware in `src/server/token.ts` (constant-time compare), except the MCP OAuth routes listed below. Any other path returns a bare 404.
> - Never add a route outside the gated sub-app. The only exception is this fixed list, mounted from `src/server/routes/oauth.ts` before the gate: `/mcp`, `/oauth/authorize`, `/oauth/register`, `/oauth/token`, `/oauth/revoke`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`. Adding to this list needs my explicit approval.
> - `/mcp` requires a valid OAuth access token, and those tokens reach `/mcp` only, never the gated app. Only hashes of OAuth codes and tokens are stored.
> - `MCP_CONNECT_CODE` is accepted only by the consent form at `POST /oauth/authorize`, rate limited and compared through `src/server/token.ts`. `APP_TOKEN` is never accepted by any OAuth route. Never log the form body.

Also add one line to section 4's neighbour as a new `### MCP` section: "MCP tools never return, change or create a hidden title. All tool handlers go through `run()`." The opening line of CLAUDE.md ("Access is a secret URL token, no accounts") stays accurate for the app itself.

## Stremio impact
- None. No manifest or catalog change, no `version` bump. Ids untouched.

## Steps
Each step: `pnpm typecheck && pnpm lint`, commit, then the `CHANGELOG.md` follow-up commit (`docs: update changelog`). The public surface only appears at step 4.

1. `refactor(api): extract watchlist logic into a shared module`. No behaviour change; run the REST regression. — files: `src/server/watchlist.ts`, `src/server/routes/api.ts`
2. `feat(db): add oauth client and grant tables`. Check the generated SQL. — files: `src/server/db/schema.ts`, `drizzle/0004_*`, `drizzle/meta/*`
3. `feat(oauth): add token, client and redirect helpers`. Not mounted yet. Export `isAppToken`. — files: `src/server/oauth/{config,clients,tokens,pkce,redirect_uri,authorize_request}.ts`, `src/server/rate_limit.ts`, `src/server/token.ts`
4. `feat(oauth): add metadata, registration, token and revoke endpoints`. Mount before the gate. — files: `src/server/routes/oauth.ts`, `src/server/app.ts`
5. `feat(oauth): add server-rendered consent page`. After the designer's section. Includes the COOP middleware. — files: `src/server/oauth/consent_page.ts`, `src/server/routes/oauth.ts`, `src/server/app.ts`
6. `feat(mcp): add MCP endpoint with watchlist tools`. Pin `@modelcontextprotocol/server@2.4.0` exactly, in `dependencies` (the bundle leaves deps external and the image prunes dev deps). — files: `package.json`, `pnpm-lock.yaml`, `src/server/mcp_tools.ts`, `src/server/routes/oauth.ts`
7. `feat(api): list and revoke MCP connections`. — files: `src/server/routes/api.ts`
8. `docs(mcp): document the MCP rules and connection steps`. CLAUDE.md, only with the wording the user approved, placeholders only. No `mise.toml.example` change unless decision 3 picks the separate code.
   - Claude Code: `claude mcp add --scope user --transport http popcorn ${SITE_URL}/mcp`, then `/mcp` > Authenticate.
   - claude.ai: Settings > Connectors > Add custom connector, `https://popcorn.<domain>/mcp`, then sign in.
   - Gemini CLI: `{ "mcpServers": { "popcorn": { "httpUrl": "https://popcorn.<domain>/mcp" } } }` in `~/.gemini/settings.json`, then `/mcp auth popcorn`.
   - Revoking: the `curl` commands for `/api/connections`, using `<token>` placeholders.
9. Run "How to verify" locally. Reviewer.
10. On a green review: push to `main`, `gh run watch`, `mise run portainer_redeploy`. Live tests. Then mark the plan implemented and move it to `done/`.

## Design

Scope: the OAuth authorize page only (`GET` and `POST /oauth/authorize`), step 5. One server-rendered HTML
document, no JavaScript, no external asset. The optional "Connected apps" card (decision 8) is not designed.

### Conflicts with the plan and the existing app
1. **Palette.** The plan says to hardcode hex from `--background` (`#130e0a`) and to support light and dark via
   `prefers-color-scheme`. The app has no hex values and no light mode: `src/web/index.css` is "Dark only: one token
   set on :root", all in `oklch()`. Design: copy the existing `oklch()` values verbatim into the page's `:root`
   under the same token names (so no raw hex and the page stays in sync by eye), and ship **dark only** with
   `color-scheme: dark`. A light variant would be a look the app doesn't have. See Questions.
2. **Connection limit.** The plan raises it at approve. Design also checks it at unlock, so nobody picks a member
   and then gets refused. Its copy cannot send people to a "Connected apps" screen, since decision 8 has no UI.
3. **Deny is a separate form** (see Layout), so the secret field is never submitted on Refuser. The plan's
   "form: original params plus action" still holds: the deny form carries params plus `action=deny` and nothing else.
4. **Where the secret lives.** On a phone with the installed PWA there is no URL bar, so `APP_TOKEN` is only
   reachable through the Stremio card's copy button (the whole manifest URL, token in the middle). That makes
   decision 3 (`MCP_CONNECT_CODE`) more attractive than the plan's recommendation suggests. Flagged, not changed.

No other conflict: the CSP (inline `<style>` allowed, no `form-action`, no inline script) fits this design as is.

### User flow
1. Claude (or Claude Code, Gemini CLI) opens `/oauth/authorize?...` in a browser → secret step: where the app
   will return to, what it can do, a secret field.
2. Pastes the secret, taps Continuer → native POST. Wrong: same page again, with an error and the field focused
   and empty. Too many wrong: rate-limited page. Right: member step (or "no members" / "limit reached" page).
3. Picks who is connecting, taps Autoriser → 303 to the client, which finishes the exchange. There is no success
   page of our own.
4. At any point, Refuser (or "Retourner à ...") → 303 to the client with `error=access_denied`.
5. Invalid client or redirect → error page with no link back.

### Screens

#### Shared page shell (all states)
Wireframe (mobile, 375px), secret step:
```
+-----------------------------------+
|  (16px page padding)              |
| +-------------------------------+ |
| | Popcorn                       | |  wordmark, text, --primary
| | Connecter une app à Popcorn   | |  h1
| |                               | |
| | RETOUR VERS                   | |  dt, muted, 12px caps
| | claude.ai                     | |  dd, 18px, 600  (trust signal)
| | Nom donné par l'app :         | |  muted 14px, quoted, wraps
| |   « Claude »                  | |
| |                               | |
| | Cette app pourra :            | |
| |  - voir ta liste              | |
| |  - ajouter des titres et      | |
| |    changer leur statut        | |
| |  - retirer des titres         | |
| | Elle ne voit pas les surprises| |
| |                               | |
| | Secret de Popcorn             | |  label
| | [•••••••••••••••••••••••]     | |  44px, 16px text
| | Colle le secret ...           | |  hint, muted 14px
| | [      Continuer           ]  | |  primary, 44px, full width
| +-------------------------------+ |
| [        Refuser              ]   |  outline, 44px (own form, below card)
| Tu n'as pas lancé cette connexion?|  muted 14px, centered
| Refuse.                           |
+-----------------------------------+
```
- Layout: one column, `<main>` card `max-width: 28rem`, centered horizontally. Mobile: 16px page padding, card
  padding 20px, 16px gaps, buttons full width and stacked. Desktop (>= 640px): same single column, card top margin
  `10vh`, padding 24px, nothing else changes. Body is `min-height: 100dvh`, top-aligned so the on-screen keyboard
  never hides the heading, and it scrolls. Safe-area insets are not needed (this opens in a browser tab or an
  in-app browser, not the standalone PWA); don't set `viewport-fit=cover`.
- Components: no Shadcn, no lucide, no images. Plain `<main>`, `<form>`, `<label>`, `<input>`, `<button>`, `<dl>`,
  `<fieldset>`. Visual parity with `src/web/components/ui/button.tsx` and `input.tsx`: 44px height (`h-11`), radius
  `var(--radius)` (0.75rem, `rounded-lg`), 16px input text (stops iOS zoom, same reason as `input.tsx`), `border-input`.
- Typography and color: system stack only (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  Inter is under the token). Tokens, copied verbatim from `src/web/index.css`: `--background`, `--foreground`,
  `--card`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--destructive`, `--border`,
  `--input`, `--radius`. One page-local addition: `--error-text: oklch(0.78 0.13 25)`, because `--destructive`
  (0.58 lightness) is about 4.4:1 on `--background` and lower on `--card`, under the 4.5:1 text minimum. Use
  `--destructive` only for borders, never for text.
- Page CSS (inline `<style>` in `<head>`, classes only, no `style=""` attributes, no `url()`):
```css
:root{color-scheme:dark;
  --background:oklch(0.17 0.012 60);--foreground:oklch(0.96 0.01 85);--card:oklch(0.21 0.014 60);
  --primary:oklch(0.83 0.16 85);--primary-foreground:oklch(0.2 0.02 60);
  --muted:oklch(0.26 0.014 60);--muted-foreground:oklch(0.72 0.02 80);
  --destructive:oklch(0.58 0.21 25);--error-text:oklch(0.78 0.13 25);
  --border:oklch(1 0 0 / 12%);--input:oklch(1 0 0 / 16%);--radius:.75rem}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;padding:1rem;background:var(--background);color:var(--foreground);
  font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:28rem;margin:0 auto}
@media(min-width:640px){main{margin-top:10vh}}
.card{background:var(--card);border:1px solid var(--border);border-radius:calc(var(--radius) + 4px);padding:1.25rem}
.brand{color:var(--primary);font-weight:600}
h1{font-size:1.375rem;line-height:1.25;margin:.25rem 0 1rem}
.btn{display:flex;align-items:center;justify-content:center;width:100%;height:2.75rem;padding:0 1rem;
  border-radius:var(--radius);font:inherit;font-size:.875rem;font-weight:500;cursor:pointer;
  border:1px solid var(--input);background:transparent;color:var(--foreground);touch-action:manipulation}
.btn-primary{background:var(--primary);color:var(--primary-foreground);border-color:transparent}
.btn:hover{filter:brightness(1.08)}
.field{width:100%;height:2.75rem;padding:0 .75rem;border-radius:var(--radius);border:1px solid var(--input);
  background:transparent;color:var(--foreground);font:inherit;font-size:1rem}
.field[aria-invalid=true]{border-color:var(--destructive)}
:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.muted{color:var(--muted-foreground);font-size:.875rem}
.error{color:var(--error-text);border-left:3px solid var(--destructive);padding-left:.75rem;margin:.5rem 0}
.host{font-size:1.125rem;font-weight:600;overflow-wrap:anywhere}
.name{overflow-wrap:anywhere}
.member{display:flex;align-items:center;gap:.75rem;min-height:3.25rem;padding:.5rem .75rem;margin:.5rem 0;
  border:1px solid var(--input);border-radius:var(--radius);cursor:pointer;overflow-wrap:anywhere}
.member input{width:1.375rem;height:1.375rem;flex:none;accent-color:var(--primary)}
.member:has(input:checked){border-color:var(--primary);background:var(--muted)}
.member:has(:focus-visible){outline:2px solid var(--primary);outline-offset:2px}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.stack>*+*{margin-top:.75rem}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
```
- Head: `<html lang="fr">`, `<meta charset>`, `<meta name="viewport" content="width=device-width, initial-scale=1">`,
  `<meta name="color-scheme" content="dark">`, `<meta name="robots" content="noindex">`,
  `<link rel="icon" href="data:,">` (stops a `/favicon.ico` request; `data:` is in `img-src`), no `<base>`.
  `<title>` is per state, "<state> - Popcorn", never the client name.
- Interactions: none beyond native. No spinner, no JS disabling of buttons. Tap targets 44px or more.

#### Secret step (`GET /oauth/authorize`, and `POST` re-renders)
- Order in the DOM (this is the tab order and decides what Enter does): `h1`, client block, permissions, form 1
  (secret field, **Continuer**), form 2 (**Refuser**), reassurance line. Enter in the field submits form 1.
- Form 1: `method="post" action="/oauth/authorize"`, hidden fields for every validated param (`response_type`,
  `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method`, `state`, `resource`, `scope`, only
  those present), plus `<button name="action" value="unlock">`. One helper renders the hidden fields for all
  forms, auto-escaped by `hono/html`.
- Form 2: same hidden fields, one `<button name="action" value="deny">Refuser</button>`, no secret field, so
  nothing to validate and no secret submitted. Refuser is the `outline` look, Continuer is `primary`.
- **Client block** (a `<dl>`):
  - `Retour vers` is the trust signal and is the largest text of the block. Value is the hostname of the
    validated `redirect_uri` from `new URL().hostname` (ASCII/punycode, so no lookalike glyphs). Loopback shows
    "Une app sur cet ordinateur" instead, never `localhost` or a port. No full URL, no path, no query.
  - `Nom donné par l'app` is secondary: muted, smaller, shown inside « », `overflow-wrap:anywhere`, the label
    saying it is self-declared. The name is never in `h1`, `<title>`, the buttons, `aria-label`s or the member
    step's heading. If the name is empty after sanitizing, omit the row. The server already strips control and
    bidi characters and caps at 100; render with `hono/html` escaping only.
  - No "verified" badge: the allowlist (decision 5) is what makes the host trustworthy, and a badge would
    overstate it for loopback.
- **Permissions**: a `<ul>` of three short items plus one line saying surprises stay invisible (decision 6).
- **Secret field**:
  - `<label for="secret">Secret de Popcorn</label>`, `<input id="secret" name="app_token" type="password"
    required autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false"
    enterkeyhint="go" aria-describedby="secret-hint">`.
  - Why `current-password`: it is a password-like secret, and this lets a phone's password manager fill it
    (the easiest way to enter a 48-character string). `one-time-code` would wrongly offer SMS codes, `off` would
    block the manager. No `maxlength` (would silently truncate a paste). No show/hide toggle (needs JS); paste works
    in password fields on iOS and Android. No `autofocus` on first load, so the host line is read first.
  - Hint: `<p id="secret-hint" class="muted">` explaining where the secret comes from.
- **Wrong secret** (HTTP 401, same page re-rendered): the field is empty (never `value=`), has
  `aria-invalid="true"` and `autofocus`, and `aria-describedby="secret-error secret-hint"`. The error `<p
  id="secret-error" class="error">` sits directly above the field, prefixed by `<span class="vh">Erreur : </span>`
  (color is not the only cue). `<title>` becomes "Secret incorrect - Popcorn". The text is identical for every
  failure and never says how close it was. No `role="alert"`: the autofocus plus `aria-describedby` makes screen
  readers read it once on focus.
- The hidden params are re-emitted from the validated server-side copy, never from the raw POST body.

#### Member step (`POST action=unlock` succeeded)
Wireframe (mobile):
```
+-------------------------------+
| Popcorn                       |
| Qui se connecte ?             |  h1
| Retour vers  claude.ai        |  same block, compact, no client name
|                               |
| Les titres ajoutés par cette  |
| app seront à son nom.         |  muted
|                               |
| Membre                        |  legend
| +---------------------------+ |
| | (o)  Alice                | |  52px row
| +---------------------------+ |
| | ( )  Bob                  | |
| +---------------------------+ |
| Cette étape expire en 10 min. |  muted small
| [      Autoriser           ]  |  primary
+-------------------------------+
[        Refuser              ]
```
- Layout: same shell. The return host stays visible, because this is the moment of approval.
- Components: `<form>` with hidden params, hidden `ticket`, `<fieldset><legend>Membre</legend>` containing one
  `<label class="member"><input type="radio" name="member_id" value="<id>" required> Name</label>` per member,
  in `members` order. Radios use native inputs (`accent-color`), the whole row is the label, so the target is the
  full 52px row. `<button name="action" value="approve">Autoriser</button>`; Refuser in its own deny form.
- Preselection: none when there are 2 or more members (a default would silently mis-attribute). Exactly one
  member: `checked`. Native `required` blocks submit with a browser-localized message.
- Server fallback if `member_id` is missing or not found: re-render this step with a fresh `ticket`, status 400, the
  error "Choisis qui se connecte." above the fieldset, `aria-describedby` on the fieldset pointing to it, focus
  via `autofocus` on the first radio.
- Names are user-entered: escape, `overflow-wrap:anywhere`, no truncation.
- No titles, counts, or other data on this page.

#### Message pages (one layout, five variants)
Wireframe (mobile):
```
+-------------------------------+
| Popcorn                       |
| <h1 title of the state>       |
| <1-2 sentences, muted>        |
| [  Retourner à claude.ai   ]  |  deny form, outline (not on invalid)
+-------------------------------+
```
Same shell, no field. The button is a deny form (`action=deny`), labelled "Retourner à `<host>`" or "Retourner à
l'app" for loopback, since the person is leaving without allowing. Used for: rate limited, no members, connection
limit. The invalid-request page has no button and no link, as there is no trusted way back.
- Rate limited: HTTP 429 with `Retry-After`. No secret field, so nobody keeps typing. The minutes shown are
  `ceil(retryAfter / 60)`, minimum 1. The text is the same for the per-IP and the global limit.
- Expired or tampered ticket: re-renders the **secret step** (HTTP 401, params still valid) with an error above the
  field, and `autofocus`, so it is never a dead end. Same text for expired and tampered. If the params are invalid
  too, show the invalid-request page.
- No members: shown only after the secret is verified (see Member list and privacy below).
- Connection limit (20 active grants): checked at unlock and again at approve.
- Unexpected failure: a catch around the consent handlers renders a generic variant ("Une erreur est survenue") with
  HTTP 500, instead of the JSON from `app.onError`, which a browser user would see raw. No details, no stack.

### Member list and privacy (no JS)
The member names are **not** rendered, fetched, or embedded (no hidden `<select>`, no data attribute, no CSS) in any
response until `isAppToken` has passed on a `POST action=unlock`. Therefore the secret step is separate from the
member step: two native POSTs, the second carrying the stateless `ticket`. This costs one extra tap and page load,
and it is the only no-JS way to keep the list private. A single page with both would leak the names to anyone with a
valid `client_id` and redirect.
- What still leaks: the page itself says "Popcorn", and a correct secret proves membership of the group. Nothing else.
- "No members yet" is also behind the secret: its existence would say the DB is empty. The person typed the secret
  just to learn that, which is acceptable for a private app and consistent with the rule.
- Both steps are `Cache-Control: no-store`, so Back doesn't show a cached member list from another visit.

### Adapting to the open decisions
| Decision | What changes in this design |
|---|---|
| 3: `MCP_CONNECT_CODE` | Only copy: `secret.label` ("Code de connexion"), `secret.hint`, `secret.title`, error text ("Code incorrect."). Field `name` can stay `app_token` or become `connect_code`, no layout change. Keep `type="password"` and `current-password` |
| 4: no member binding | Drop the member step, ticket, "no members" and "ticket expired" states. The secret step's primary button becomes **Autoriser** (`action=approve`, with the secret), and the "au nom de" line goes. Connection limit and rate limit pages stay. The `addedBy` input is then the model's job, not the page's |
| 5: any HTTPS host | The host line gets more weight: show the hostname for every redirect, and for any host outside a short known list (`claude.ai`, `claude.com`) add a `.error`-styled warning row "Adresse inconnue. N'autorise que si tu viens de lancer cette connexion." with a `--destructive` left border. Nothing else |
| 8: connections UI | The connection-limit copy can then say "Retire-en une depuis Popcorn" |

### States
- Loading: none of our own; the browser shows its native navigation indicator. A double tap on Continuer or
  Autoriser sends two POSTs (no JS to disable the button). Harmless: unlock re-renders, approve issues a second
  unused code that the sweep removes; but a double failed unlock counts twice against the limiter. Accept.
- Empty: "no members" variant. Empty client name: row omitted.
- Error: wrong secret, member missing, ticket expired, rate limited, connection limit, invalid request, unexpected
  failure (all in Copy). Each has a distinct `<title>`.
- Success: 303 to the client, no page. If the target is a loopback app that isn't listening, the browser shows its own
  connection error; there is no JS fallback link, and that is accepted. Back returns to a `no-store` page.
- Slow network / offline: native browser behaviour, since the service worker's scope is `/<token>/` and doesn't
  control this page. The page is not designed to work offline. A failed POST on a flaky connection shows the
  browser's error page, and Back plus resubmit works.

### Copy
French, "tu", like the app. `{host}` is the redirect hostname; for loopback use the `.local` variants.

| Key | Text |
|-----|------|
| brand | Popcorn |
| secret.title | Connecter une app à Popcorn |
| secret.pageTitle | Connexion - Popcorn |
| client.returnLabel | Retour vers |
| client.returnLocal | Une app sur cet ordinateur |
| client.nameLabel | Nom donné par l'app |
| perms.lead | Cette app pourra : |
| perms.read | voir ta liste |
| perms.write | ajouter des titres et changer leur statut |
| perms.remove | retirer des titres |
| perms.surprise | Elle ne voit jamais les titres surprise. |
| secret.label | Secret de Popcorn |
| secret.hint | C'est le long texte dans l'adresse de Popcorn, juste après le nom de domaine. Colle-le ici. |
| secret.continue | Continuer |
| secret.deny | Refuser |
| secret.notYou | Tu n'as pas lancé cette connexion ? Refuse. |
| secret.wrongTitle | Secret incorrect - Popcorn |
| secret.wrong | Secret incorrect. Vérifie que tu l'as copié en entier. |
| secret.expired | Cette étape a expiré. Saisis à nouveau le secret. |
| a11y.errorPrefix | Erreur : |
| member.title | Qui se connecte ? |
| member.pageTitle | Choisir un membre - Popcorn |
| member.lead | Les titres ajoutés par cette app seront à son nom. |
| member.legend | Membre |
| member.expires | Cette étape expire au bout de 10 minutes. |
| member.allow | Autoriser |
| member.missing | Choisis qui se connecte. |
| back.host | Retourner à {host} |
| back.local | Retourner à l'app |
| rate.title | Trop d'essais |
| rate.body | Réessaie dans {n} min. Cette limite protège ton secret. |
| noMembers.title | Personne dans la liste pour l'instant |
| noMembers.body | Ajoute-toi d'abord dans l'app Popcorn, puis relance la connexion depuis l'app à connecter. |
| limit.title | Trop d'apps connectées |
| limit.body | Il y a déjà 20 connexions actives. Retire-en une, puis recommence. |
| invalid.title | Lien de connexion invalide |
| invalid.body | Cette demande est incomplète ou n'est plus valable. Ferme cet onglet et relance la connexion depuis l'app. |
| fail.title | Une erreur est survenue |
| fail.body | Réessaie dans un instant. |

### Accessibility
- One `<h1>` per page, a single `<main>`, `lang="fr"`, `<title>` distinct per state (screen readers announce it on
  load after a POST).
- Every control has a visible `<label>` or `<legend>`; no placeholder-as-label. The secret field has no placeholder.
- Error association: `aria-invalid="true"` plus `aria-describedby` listing the error id first, then the hint id;
  autofocus on the field after a failure moves focus to where the fix is. Same pattern for the member error. No
  duplicate `role="alert"`.
- Errors are never color-only: a visually hidden "Erreur : " prefix and a left border plus text.
- Focus: visible 2px `--primary` outline with offset on every control, and on the whole radio row via `:has(:focus-visible)`.
  Tab order follows the DOM: field, Continuer, Refuser. Enter submits Continuer because it comes first.
- Contrast (estimated from the tokens, to confirm in a browser): body and muted text on `--card` above 7:1 and
  `--primary-foreground` on `--primary` above 8:1; error text uses `--error-text`, not `--destructive`.
- Targets: buttons and field 44px, radio rows 52px, with the radio at 22px.
- Text sizes in rem; the input is 16px so iOS doesn't zoom; text reflows to 320px with `overflow-wrap:anywhere` on
  the host, client name and member names (all attacker- or user-supplied).
- `prefers-reduced-motion`: the page has no animation; the media query is kept for safety.
- Password managers: `autocomplete="current-password"`; paste is never blocked.

### Questions
1. **Dark only, or also light?** The plan says both. The app is dark only, so this design is too. A light variant is
   one extra `@media (prefers-color-scheme: light)` block of about 10 token values that I'd have to invent, because the
   app defines none. Recommendation: dark only.
2. **Decision 3 with this page in mind.** A pasted 48-character `APP_TOKEN` is workable with a password manager, but
   retrieving it on a phone with the installed PWA means copying the Stremio manifest URL and cutting the token out.
   `MCP_CONNECT_CODE` fixes that, and the copy table already isolates the strings it would change.
3. **Connection-limit copy** says "Retire-en une" but, per decision 8, there is no screen for that, only `curl`. Fine
   for now, or add the Connected apps card?
4. **Double-submit** is accepted. If you'd rather prevent a duplicate grant, the server could make approve idempotent
   per ticket, which needs storage the stateless ticket design avoids. Recommendation: accept.

Optional, not in these steps: a "Connected apps" card next to `src/web/components/stremio_card.tsx` using `/api/connections`. Not essential: the API, the `curl` commands and automatic expiry are enough for this app. Decision 8.

## Risks and open questions
- Decisions 1–8 above.
- **Size**: about 700 lines plus a page, a large addition for a two-user app. If the Google product turns out not to need OAuth, it's still justified only by the benefits under "What Google clients need".
- **Cloudflare**: `/mcp`, `/oauth/*` and `/.well-known/*` must not be challenged. Claude's calls come from `160.79.104.0/21` (per its docs), Gemini CLI's from the user's machine, and Google Enterprise's from unknown ranges, so write the skip rule by path, not by IP. Bot Fight Mode may not be skippable by rule on all plans (from memory, unverified), and would then need turning off. Don't cache these paths; `/oauth/token` sends `no-store`.
- **Existing gate has no rate limit**: `/<guess>/` is already an unlimited oracle for `APP_TOKEN`, so the form adds no new guessing power; its limiter just doesn't make it worse. Limiting the gate is a separate change.
- **Prompt injection**: titles and overviews are community-edited TMDB text returned to a model that can call `remove_title`. Mitigated by `destructiveHint` and opt-in overviews. Removal has no undo over MCP.
- **SDK**: 2.x is young and pinned exactly. The probes covered 2025-era traffic only, not the 2026-07-28 path.

## How to verify
Throwaway DB, separate port. With the mise env loaded:

```bash
pnpm typecheck && pnpm lint && pnpm build
grep -rl modelcontextprotocol dist/web    # expect nothing

export SITE_URL=http://localhost:8788 PORT=8788 DATABASE_PATH="$(mktemp -d)/t.db"
pnpm start    # in another shell, with the same env

B=$SITE_URL; G="$B/$APP_TOKEN"
curl -s "$G/api/members" -H 'Content-Type: application/json' -d '{"name":"A"}'
curl -s "$G/api/members" -H 'Content-Type: application/json' -d '{"name":"B"}'
MID=$(curl -s "$G/api/members" | jq '.[0].id')
```

1. **Discovery**: `curl -i -X POST $B/mcp` gets 401 with `WWW-Authenticate` naming `$B/.well-known/oauth-protected-resource/mcp`. That URL returns `resource: "$B/mcp"`, and `$B/.well-known/oauth-authorization-server` lists the endpoints.
2. **Full flow**:
   ```bash
   CID=$(curl -s $B/oauth/register -H 'Content-Type: application/json' \
     -d '{"client_name":"curl","redirect_uris":["http://localhost:9999/cb"],"token_endpoint_auth_method":"none"}' | jq -r .client_id)
   V=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')
   C=$(printf %s "$V" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
   P=(--data-urlencode response_type=code --data-urlencode client_id=$CID --data-urlencode redirect_uri=http://localhost:9999/cb
      --data-urlencode code_challenge=$C --data-urlencode code_challenge_method=S256 --data-urlencode state=s1)
   S=(-H 'Sec-Fetch-Site: same-origin')

   curl -s -G $B/oauth/authorize "${P[@]}" | grep -c 'member_id'   # expect 0: no member data before the secret
   TICKET=$(curl -s $B/oauth/authorize "${S[@]}" "${P[@]}" --data-urlencode action=unlock --data-urlencode app_token="$APP_TOKEN" \
     | grep -oP 'name="ticket" value="\K[^"]+')
   LOC=$(curl -s -o /dev/null -w '%{redirect_url}' $B/oauth/authorize "${S[@]}" "${P[@]}" \
     --data-urlencode action=approve --data-urlencode ticket="$TICKET" --data-urlencode member_id=$MID)
   echo "$LOC"   # has code, state=s1, iss=$B
   CODE=$(sed -E 's/.*[?&]code=([^&]+).*/\1/' <<<"$LOC")
   T=$(curl -s $B/oauth/token -d grant_type=authorization_code -d client_id=$CID -d code="$CODE" \
     --data-urlencode redirect_uri=http://localhost:9999/cb -d code_verifier="$V")
   AT=$(jq -r .access_token <<<"$T"); RT=$(jq -r .refresh_token <<<"$T")

   H=(-H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream')
   curl -s $B/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
   curl -s $B/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'    # five tools
   curl -s $B/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_titles","arguments":{"query":"matrix"}}}'
   ```
3. **Bare 404 stays**: each returns 404 with an empty body:
   ```bash
   for p in / /nope /wrong-token/api/titles /wrong-token/mcp /mcp/x /oauth/nope /.well-known/nope /.well-known/openid-configuration; do
     curl -s -o /dev/null -w "$p %{http_code} %{size_download}\n" $B$p; done
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' $B/oauth/token     # GET on a POST route
   ```
   Then `$G/api/titles` is 200, and `$B/$AT/api/titles` is a bare 404, so an access token can't reach the gated app.
4. **Token failures**: wrong PKCE verifier, reused code (grant revoked), wrong `redirect_uri`, `resource=https://evil.example/mcp` give `invalid_grant` or `invalid_target`. A refresh rotates; reusing the old `$RT` returns `invalid_grant` and revokes the grant, so the newest access token stops working too. An expired or made-up bearer gets 401 with `error="invalid_token"`.
5. **Consent failures**: six wrong secrets give 429 on the sixth; restart resets. `redirect_uri` not registered, or `https://evil.example/cb` at registration, is refused, and the authorize error page has no redirect. Cross-site POST (`Sec-Fetch-Site: cross-site`) gets 403. A tampered or expired `ticket` is refused. `action=deny` returns 303 with `error=access_denied`. `POST /oauth/token` still works with no `Sec-Fetch-Site` header.
6. **Attribution**: `add_title` (27205, `movie`) has `added_by` of member A. Delete member A in the throwaway DB: the next `/mcp` call gets 401, and the title keeps its `added_by`.
7. **Tools**: `list_titles`, `set_title_status` to `watched` and back, `remove_title`. Unknown `tmdbId`, duplicate add, `query: "a"` give `isError` with the fixed text.
8. **Surprises**: A adds 603 via REST with `hidden: true`, then with B's grant and with A's:
   - `list_titles` doesn't show it, and `search_titles "matrix"` has `inList: false`.
   - `set_title_status` and `remove_title` with its id say "Title not found"; `GET /api/titles?member=A` shows it unchanged and hidden.
   - A's `add_title` says "Already in the list". B's succeeds with no `addedBy` in the response; the row is visible and `added_by` is still A.
   - No output contains `hidden`.
9. **Revocation**: `GET $G/api/connections` lists it; `DELETE` it; the next `/mcp` call gets 401. Restart with a new `APP_TOKEN`: all grants get 401 on `/mcp` and `invalid_grant` on refresh.
10. **Secrets not logged**: capture server stdout during all the above at `LOG_LEVEL=debug` and grep for `$APP_TOKEN`, `$AT`, `$RT`, `$CODE`, `$V`. Expect 0 matches.
11. **REST regression**: `POST /api/titles` gives 201, 409, 200 (defuse), 400, 404, 422 as before; `PATCH`, `/reveal`, `DELETE`, `/search`; click through add, watched, undo and reveal in `pnpm dev`.
12. **Stremio unchanged**: `manifest.json` still `1.1.0`; `catalog/movie/to_watch.json` excludes the surprise.
13. **Browser consent**: open the authorize URL in a real browser with a local loopback listener. The form POST works under `Origin: null`, the CSP doesn't block the 303 to `http://localhost`, Chrome shows no insecure-form warning, the page renders in the dark theme, and `/oauth/authorize` has no COOP header.
14. **Real clients, locally**: Claude Code against `http://localhost:8788/mcp` (`/mcp` > Authenticate). Gemini CLI against the same URL (`/mcp auth popcorn-local`). Remove them after.
15. **After deploy, with the Cloudflare rules checked**: Claude Code and Gemini CLI against `${SITE_URL}/mcp`, then a claude.ai custom connector: sign in, ask "what's on our watchlist?", confirm a surprise doesn't appear, and test claude.ai's window handling. Then the user's Google product, once named.

### What was and wasn't verified while planning
- **Read**: Gemini CLI source, client SDK 1.29.0, MCP spec 2025-06-18 and 2025-11-25 (fetched pages), Claude connector docs, Google Cloud's Gemini Enterprise docs, the Gemini API docs, and lepetitmonde's code.
- **Run**: scratch probes of the SDK with Popcorn's Hono and node-server (MCP over a socket, GET 405, no session); route order and bare 404; `csrf()`; COOP removal. These used stub routes, not the real OAuth code, which doesn't exist yet.
- **Not verified**: any real client completing this flow against Popcorn; whether claude.ai uses a popup; the consumer Gemini app; real browser behaviour for `Origin: null` and the redirect (from the Fetch and CSP specs, plus lepetitmonde's comment); Cloudflare's rules; a per-request handler on Popcorn (same pattern as lepetitmonde in production).
