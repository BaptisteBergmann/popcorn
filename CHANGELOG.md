# Changelog

## 2026-11-01

- `fdd6679` fix(oauth): distinct expired-step title, default port for https redirects, accurate limiter comment
- `57b9525` fix(oauth): log only known authorize values, log MCP errors by class and render a page on consent GET failure
- `b266adc` fix(oauth): kill grants on code rotation or member removal at code exchange and list live connections only
- `373acde` fix(env): reject a connect code equal to APP_TOKEN, redact it and ship it empty
- `51e4aab` fix(oauth): report the wait of the tripped limiter only
- `cc5d0df` docs(mcp): document the MCP rules and connection steps
- `483e436` feat(api): list and revoke MCP connections
- `c3ef4de` feat(mcp): add MCP endpoint with watchlist tools
- `504b6ef` feat(oauth): add server-rendered consent page
- `66975f8` feat(oauth): add metadata, registration, token and revoke endpoints
- `cf9a28e` build: add MCP_CONNECT_CODE to the env template and compose file
- `7632810` feat(oauth): add token, client and redirect helpers
- `074193d` feat(db): add oauth client and grant tables
- `75def9c` refactor(api): extract watchlist logic into a shared module
- `842b5f1` docs: allow MCP OAuth routes outside the gate and add MCP plan
- `baf3376` fix(web): show list error state when members fail to load

## 2026-10-31

- `5e97627` docs: mark hidden surprise titles plan as implemented
- `afbe539` style(server): collapse wrapped calls in api routes
- `5ae2398` fix(api): defuse a surprise when a concurrent insert wins the race
- `a9eccda` fix(web): remove duplicate margin on card actions
- `2a57ebc` fix(web): flip inList only in the adder's cached searches
- `56c25ff` feat(web): add and reveal surprise titles
- `0c27a1b` feat(web): hooks for surprise titles
- `1f32bd1` style(server): restore repo quote style in api and stremio routes
- `9fce3b1` feat(stremio): keep surprises out of regular catalogs
- `69003b9` feat(api): support hidden surprise titles
- `688a06f` feat(db): add hidden flag to titles
- `f3ba466` feat(stremio): add random catalogs
- `99a4151` docs: mark watchlist MVP plan as implemented
- `a1dae83` fix(db): only swallow unique collisions when rekeying members
- `264950e` fix(db): recompute member keys at startup and share memberKey with web
- `baab8d3` docs: list /api/members in the SW caching rules
- `1227ff1` fix(web): look up existing member in fresh data on 409
- `b05a6cb` style(api): drop unused sql import
- `fb52de0` fix(db): use a Unicode-folded name_key for member uniqueness
- `e7ac2a8` fix(tmdb): log rate limiting with retry-after
- `3ad1172` fix(server): allow TMDB in connect-src and return 400 for malformed JSON
- `dc22886` build: add Dockerfile, CI workflow and Portainer compose
- `ead5fb8` feat(pwa): add token-scoped manifest, service worker, icons and iOS meta
- `c9f9fad` feat(api)!: replace MEMBERS env with members table and routes
- `00ed214` feat(web): add list, add and name picker UI with Stremio card and install hint
- `7a27ecd` docs: make members dynamic and drop names from the plan
- `3929361` chore: tidy gitignore for the vite stack
- `e9551dc` feat(stremio): add manifest and catalog routes with CORS
- `cad3715` feat(api): add titles CRUD and TMDB search routes
- `5e33bd9` feat(server): add TMDB client for search and details
- `7f5ec40` feat(db): add titles schema, first migration and startup migrate
- `d9de8b3` feat(server): add token-gated Hono app, env, logger and SPA serving
- `259eb98` feat: scaffold Vite, React, Tailwind and tooling
- `10d43c6` chore(web): add official TMDB logo for attribution
- `e4af1e8` docs: add backlog with title detail view
- `2e7ee10` docs: add MVP design and approve plan
- `1abb4ce` docs: forbid committing the real hostname
- `524a4d9` docs: add PWA to the MVP plan and guidelines
- `d1577b8` docs: name the project Popcorn, set French UI and members
- `28324b6` docs: add project guidelines, agents and watchlist MVP plan
