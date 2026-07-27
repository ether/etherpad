# URL base-path support (X-Forwarded-Prefix / X-Ingress-Path) — Design

GitHub issue: https://github.com/ether/etherpad/issues/7802

## Problem

Etherpad assumes it is served at `/`. When a reverse proxy adds a path prefix —
Home Assistant ingress (`/api/hassio_ingress/<random-token>/`), Nginx
`location /etherpad/`, Cloudflare Worker routes — three categories of URLs
break:

1. Hard-coded leading-slash hrefs/srcs in server-rendered HTML (`/static/...`,
   `/admin/...`, `/manifest.json`, `/favicon.ico`).
2. Plugin assets injected via the inner ace iframe and via plugin DOM hooks
   that emit leading-slash URLs.
3. From-request absolute URLs in social-meta tags (`og:url`, `og:image`,
   `twitter:image`) — they pick up the bound listen address (e.g.
   `http://0.0.0.0:9001/...`) instead of the public origin.

Failures are partial and confusing: the pad loads, the toolbar renders, the
pad text round-trips through the server, but plugin CSS 404s and admin pages
are unreachable from inside the proxied iframe.

The `publicURL` setting can't fix this: HA ingress prefixes are per-session
random tokens, not stable values. Etherpad has to learn the prefix from each
request.

## Goals

- When `settings.trustProxy === true` and a proxied request carries an
  `X-Forwarded-Prefix` or `X-Ingress-Path` header, Etherpad emits every
  asset URL, admin link, manifest reference, and socket.io endpoint under
  that prefix.
- The HTML page also carries `<base href="${prefix}/">` so plugin-injected
  leading-slash URLs route through the prefix without each plugin opting in.
- Behavior with no proxy header (or with `trustProxy === false`) is byte-for-
  byte identical to today.
- No new `settings.json` field.

## Non-goals

- Static `settings.basePath` configuration. Rejected because HA ingress is
  per-session, and proxies that want a stable prefix can already set the
  header. (Confirmed during brainstorming.)
- Deprecating `publicURL`. It remains the canonical-origin setting for
  Open Graph / Twitter Card absolute URLs; basePath is orthogonal.
- Express mount-path rewiring. Proxies strip the prefix before forwarding;
  Etherpad still routes against `/p/...`.
- "No link to /admin from index" UX symptom mentioned in the issue. Out of
  scope; can be filed separately as an admin discoverability ticket.

## Header handling

Honored only when `settings.trustProxy === true`. Otherwise the parser
returns `''`.

Headers checked in this order; first non-empty wins:

1. `X-Forwarded-Prefix` (HAProxy / Traefik convention)
2. `X-Ingress-Path` (Home Assistant convention)

Sanitization, in order:

1. Trim whitespace.
2. If non-empty and not starting with `/`, prepend `/`.
3. Strip trailing slashes.
4. Reject (return `''`) on any of: `..`, `://`, `\`, control characters,
   or any character outside `[A-Za-z0-9_\-./~%]`.
5. Reject if length > 1024 chars.

Result is a plain string: `''` (no prefix) or `/some/prefix` (no trailing
slash, starts with `/`).

`''` is the sentinel for "no prefix" everywhere downstream.

## Architecture

Single source of truth — `req.basePath` — set once per request, propagated
to three sinks:

```
                       X-Forwarded-Prefix / X-Ingress-Path
                                       │
                                       ▼
                         parseBasePath() in middleware
                                       │
                            req.basePath = "/foo"
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
EJS / res.locals.basePath    clientVars.basePath          <base href="${basePath}/">
        │                              │                              │
   templates emit               pad.ts sets baseURL              plugin-injected
   <%= basePath %>/...          socket.io path follows           leading-slash URLs
   for every leading            socialMeta builds                resolve through prefix
   slash href/src               from-request URLs with           (belt-and-braces)
                                prefix
```

Backwards compatible by construction: no header → `req.basePath = ''` →
templates emit `/static/...` (today's exact output) → `<base href="/">` is a
no-op.

## Pre-existing infrastructure (discovered during plan write-up)

The codebase already has substantial proxy-path support that wasn't visible
from the issue text. The plan extends rather than replaces:

- `src/node/utils/sanitizeProxyPath.ts` — already reads `x-proxy-path`,
  sanitizes the value, returns `''` or `/...`. Same shape as the spec's
  proposed `parseBasePath`. Plan: extend the header list to also check
  `X-Ingress-Path` and `X-Forwarded-Prefix`, gated on `trustProxy`.
- `src/templates/padBootstrap.js` and `timeSliderBootstrap.js` — already
  compute `basePath` from `window.location` and set `pad.baseURL`,
  `window.plugins.baseURL`, `timeSlider.baseURL`. socket.io path
  (`socketio.connect(exports.baseURL, ...)`) and the `fetch` call in
  `pad.ts:1040` already follow the prefix without any change.
- `src/node/hooks/express/admin.ts` — already substitutes `/admin` and
  `/socket.io` in the admin SPA HTML/JS/CSS using `sanitizeProxyPath`.
  No admin Vite rebuild needed.
- `src/templates/pad.html`, `timeslider.html` — already use relative
  paths (`../static/...`, `../favicon.ico`, `../../manifest.json`), so
  they pick up the prefix naturally when served behind one.
- `src/node/hooks/express/specialpages.ts` — already calls
  `sanitizeProxyPath(req)` and threads `proxyPath` into the rendered
  `entrypoint` URL.

What is NOT covered today, and forms the plan's actual scope:

1. **Header source list** — HA Ingress sends `X-Ingress-Path`; nginx
   subpath users typically rely on `X-Forwarded-Prefix`. Etherpad only
   reads `x-proxy-path`. Mismatched header → no prefix → all symptoms.
2. **`/manifest.json` icons** (`src/node/hooks/express/pwa.ts`) emit
   hard-coded `/favicon.ico` and `/static/skins/...` paths.
3. **`socialMeta` from-request URLs** (`src/node/utils/socialMeta.ts`)
   don't honor `proxyPath` when building the from-request fallback,
   producing wrong `og:url` / `og:image` under a prefix.
4. **Leading-slash URLs in `index.html`, `timeslider.html`, `pad.html`,
   `export_html.html`** — manifest link, jslicense link, reconnect
   form action. Each can be made relative or `proxyPath`-prefixed.
5. **Plugin DOM injection** — plugins that emit `<link href="/static/...">`
   at runtime aren't covered by any existing rewrite. A `<base href>`
   tag was considered as a belt-and-braces fix but rejected: path-absolute
   URLs (`/foo`) deliberately ignore the path component of `<base href>` and
   resolve against the origin, so `<base href="/sub/">` + `<link href="/static/foo">`
   still resolves to `/static/foo`. And `<base href>` would change the
   resolution base for existing relative URLs in `pad.html` /
   `timeslider.html` (e.g. `../static/css/pad.css`), breaking them. Plugin
   authors emitting leading-slash URLs need to use `clientVars`-derived or
   relative paths — documented separately as a plugin guidance issue, not
   resolved here.
6. **Settings documentation** — `settings.json.template` and `Settings.ts`
   doc comment for `trustProxy` need to mention the new header sources.

## Components

Reflects the discovery above — extends existing helpers; smaller surface than the original draft.

| File | Change |
|---|---|
| `src/node/utils/sanitizeProxyPath.ts` | Extend header source list to also read `x-forwarded-prefix` and `x-ingress-path`. Standard headers (everything other than the existing `x-proxy-path`) gated on `settings.trustProxy === true`. First non-empty wins, after sanitization. |
| `src/node/hooks/express/pwa.ts` | `/manifest.json` handler reads `sanitizeProxyPath(req)` and emits `${proxyPath}/favicon.ico`, `${proxyPath}/static/skins/...`, `${proxyPath}/` for `start_url`. Mark response `Vary: x-proxy-path, x-ingress-path, x-forwarded-prefix` + `Cache-Control: private, no-store` when proxyPath is non-empty (mirrors the admin handler's pattern). |
| `src/node/utils/socialMeta.ts` | `buildAbsoluteUrl` honors `proxyPath` when falling back to from-request origin: `${origin}${proxyPath}${pathname}`. `publicURL` still wins when set. |
| `src/templates/index.html` | Replace `<link rel="manifest" href="/manifest.json">` and the jslicense `<a href="/javascript">` with `proxyPath`-prefixed values. Route handler in `specialpages.ts` passes `proxyPath` as an explicit template variable. |
| `src/templates/timeslider.html`, `pad.html` | jslicense `<a href>` and `<form action="/ep/pad/reconnect">` use `proxyPath`. Fix pre-existing `..`-count bug in the manifest `<link>` (`../../manifest.json` in pad.html resolves under a prefix as `/manifest.json` instead of `/sub/manifest.json`; ditto `../../../manifest.json` in timeslider). Reduce by one to make the path correct in both root-mount and prefix-mount cases. |
| `src/templates/export_html.html` | `<link rel="manifest">` uses proxyPath via the export route's render context. |
| `src/node/hooks/express/specialpages.ts` + export route | Pass `proxyPath` into every `eejs.require` call that renders the affected templates. |
| `settings.json.template` + `Settings.ts` doc comment | Document the three honored header names and the trustProxy gate. No new field. |

Out: no new `basePath.ts`, no Express middleware, no EJS-context-wide helper, no admin Vite rebuild, no `clientVars.basePath`, no edits to `pad.ts` / `timeslider.ts` / `padBootstrap.js`. Pre-existing code already covers those surfaces (`pad.baseURL` and `window.plugins.baseURL` are derived client-side from `window.location` in `padBootstrap.js` / `timeSliderBootstrap.js`).

## Data flow — concrete example

Home Assistant ingress request:

```
GET /p/scratch HTTP/1.1
Host: 0.0.0.0:9001
X-Forwarded-Proto: https
X-Forwarded-Host: ha.example
X-Forwarded-Prefix: /api/hassio_ingress/abc123
X-Ingress-Path: /api/hassio_ingress/abc123
```

1. `app.enable('trust proxy')` → `req.protocol === 'https'`, `req.hostname === 'ha.example'`.
2. `sanitizeProxyPath(req)` → `'/api/hassio_ingress/abc123'` (read from `X-Ingress-Path` because trustProxy is on; would also accept `X-Forwarded-Prefix`).
3. `specialpages.ts` route handler for `/p/:pad`: renders `pad.html` with `proxyPath` in the template context. Output includes:
   - jslicense `<a href>` and reconnect form `action` prefixed via the EJS variable.
   - `<link rel="manifest" href="../manifest.json">` (fixed from `../../manifest.json` — see Risks): resolves to `/api/hassio_ingress/abc123/manifest.json`.
   - `<link href="../static/css/pad.css...">` is already relative — resolves under the prefix to `/api/hassio_ingress/abc123/static/css/pad.css`.
4. Browser fetches `/api/hassio_ingress/abc123/manifest.json` → `pwa.ts` route emits manifest with all icon `src` values prefixed; `start_url` prefixed.
5. Browser establishes socket.io: client-side `padBootstrap.js` computes `basePath = new URL('..', window.location).pathname` → `/api/hassio_ingress/abc123/` → `pad.baseURL` set → `socketio.connect('/api/hassio_ingress/abc123/', ...)` → socket.io path is `/api/hassio_ingress/abc123/socket.io/`. No code change here — pre-existing logic.
6. `socialMeta`: `og:url = https://ha.example/api/hassio_ingress/abc123/p/scratch`, `og:image = https://ha.example/api/hassio_ingress/abc123/favicon.ico`.
7. Inner ace iframe loads `../static/empty.html` (relative) → resolves to `/api/hassio_ingress/abc123/static/empty.html` naturally. No code change in the inner iframe; plugin CSS injected via `aceEditorCSS` is also relative-prefixed (`../static/plugins/...`).

Direct (non-proxied) request — same code path:

1. No `x-proxy-path`, no `X-Forwarded-Prefix`, no `X-Ingress-Path` → `sanitizeProxyPath(req) === ''`.
2. Templates render today's output. The reduced-`..`-count manifest link still resolves to `/manifest.json` from a root-mount pad URL (`/p/test`), so no observable change for non-proxied users.
3. `pwa.ts` returns today's manifest (icon srcs `'/favicon.ico'` etc.) when `proxyPath === ''`.

## Backwards compatibility

- Existing deployments: no header → behavior unchanged. `<base href="/">` is
  benign (HTML5 valid, no-op for absolute URLs).
- `publicURL` semantics unchanged. When set, `socialMeta` still uses it for
  the origin in OG tags; basePath only affects request-derived fallbacks.
- Plugins using `clientVars.padId`, etc. continue to work. Plugins that build
  asset URLs by hardcoding `/static/...` now route through the prefix via the
  `<base href>` belt-and-braces, even if they don't read `clientVars.basePath`.
- No new dependency, no new setting, no migration step.

## Risks

- **Plugin templates and plugin-rendered HTML** outside `src/templates/` may
  contain leading-slash URLs. We cannot auto-rewrite them. `<base href>`
  was considered as a runtime catch-all and rejected (see "Plugin DOM
  injection" above). Plugins emitting absolute URLs should prefer relative
  or `clientVars`-derived paths; documenting that recommendation is a
  separate follow-up.
- **Manifest `..`-count fix is a strict improvement.** Today's
  `../../manifest.json` in `pad.html` resolves to `/manifest.json` from a
  root-mount pad URL — a happy accident: the relative path has one `..` too
  many but the browser silently caps `..` at the path root. After the fix
  to `../manifest.json`, the result is `/manifest.json` from root and
  `/<prefix>/manifest.json` under a prefix. No regression possible at root.
  Same logic for `timeslider.html`'s `../../../manifest.json`.
- **Malicious header injection** when `trustProxy === false` is irrelevant
  (we ignore the headers). When `trustProxy === true` the operator has
  already declared the proxy trusted; sanitization (rejects `..`, scheme,
  control chars, etc.) prevents XSS via `<base href>` and prevents path
  escape. We do NOT trust headers in non-proxy mode.

## Testing

- **Unit** — `src/tests/backend/specs/basePath-unit.ts`:
  - `parseBasePath` truth table: trustProxy off → `''`; no headers → `''`;
    `X-Forwarded-Prefix: /foo` → `/foo`; `X-Forwarded-Prefix: foo` →
    `/foo`; `X-Forwarded-Prefix: /foo/` → `/foo`; `X-Forwarded-Prefix:
    /foo//` → `/foo`; `X-Forwarded-Prefix: /a/../b` → `''`; `X-Forwarded-Prefix:
    https://evil.example/foo` → `''`; `X-Forwarded-Prefix: ` (whitespace)
    → `''`; `X-Forwarded-Prefix` empty + `X-Ingress-Path: /bar` → `/bar`;
    `X-Forwarded-Prefix: /a` + `X-Ingress-Path: /b` → `/a` (first wins);
    long-string > 1024 chars → `''`; non-ASCII → `''`.
- **Backend integration** — `src/tests/backend/specs/basePath-integration.ts`:
  - supertest GET `/` with `X-Forwarded-Prefix: /api/foo` (and trustProxy
    on): rendered HTML contains `<base href="/api/foo/">`, contains
    `href="/api/foo/static/...`, contains `href="/api/foo/manifest.json"`.
  - GET `/p/test` same expectations.
  - GET `/admin/`: assert prefix is present in `<link>`/`<script>` paths and `<base href>` present. The exact mechanism (Vite `base: './'` rebuild vs. server-side templating of the admin HTML) is chosen during implementation; the test only asserts the post-render output.
  - GET `/` with same headers but trustProxy OFF: no prefix anywhere, output
    matches the trustProxy-on-no-headers output.
  - GET `/` with `X-Forwarded-Prefix: /a/../b`: no prefix (rejected),
    output identical to no-headers.
- **socialMeta** — extend existing `src/tests/backend/specs/socialMeta-unit.ts`:
  - With `req.basePath = '/api/foo'` and no `publicURL`: `og:url` and
    `og:image` carry the prefix.
  - With `publicURL` set: `publicURL` still wins (existing test); basePath
    not applied (publicURL is assumed to encode the full canonical origin
    including any path component).
- **No new E2E.** Existing Playwright suite covers normal URLs. Adding a
  reverse-proxy harness for E2E is high-effort for low marginal coverage;
  manual verification through the HA addon during the release candidate
  phase is sufficient.

## Open questions

None at design time. Implementation plan will resolve:

- Exact mechanism to thread `basePath` from HTTP request to socket.io
  handshake (existing socket handshake already attaches the original
  request; need to confirm the access pattern in `PadMessageHandler`).
- Whether `admin/vite.config.ts` rebuild produces a stable hash filename
  or whether we need to also adjust the admin route handler to scan the
  built `dist/` directory at startup.
