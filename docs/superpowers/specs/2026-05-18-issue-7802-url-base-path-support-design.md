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

## Components

| File | Change |
|---|---|
| `src/node/utils/basePath.ts` *(new)* | Exports `parseBasePath(req): string`. Pure function; tested in isolation. |
| `src/node/hooks/express.ts` | New middleware right after `app.enable('trust proxy')`: `req.basePath = parseBasePath(req); res.locals.basePath = req.basePath; next()`. |
| `src/node/eejs/index.ts` *(or wherever EJS context is built)* | Inject `basePath` into render context for every template. |
| `src/templates/pad.html`, `index.html`, `timeslider.html`, `error.html`, `javascript.html`, `export_html.html` | Replace every leading-slash `href`/`src`/`content` with `<%= basePath %>/...`. Add `<base href="<%= basePath %>/">` to `<head>` of pad/index/timeslider/error. |
| `src/templates/admin/index.html` | Regenerated from a Vite build with `base: './'` so it ships relative paths (`./assets/...`); `<base href>` injected by the admin route handler at request time (the admin SPA HTML is served via Express, so the handler can `res.locals.basePath`-render it through EJS or do a small string injection). |
| `admin/vite.config.ts` | `base: './'`. Commit regenerated `src/templates/admin/index.html`. |
| `src/node/handler/PadMessageHandler.ts` | Thread `basePath` from the socket handshake (`socket.request.basePath`) into `clientVars.basePath`. |
| `src/static/js/pad.ts` | `exports.baseURL = (clientVars.basePath || '') + '/'`. Existing `socketio.connect(exports.baseURL, ...)` picks it up. |
| `src/static/js/timeslider.ts` | Same — pass `clientVars.basePath + '/'` to `socketio.connect`. |
| `src/node/utils/socialMeta.ts` | `buildAbsoluteUrl` honors `req.basePath` when falling back to request-derived origin: `${origin}${req.basePath}${pathname}`. `publicURL` still wins when set. |
| `settings.json.template`, `Settings.ts` doc comment | Document that `trustProxy: true` also makes Etherpad honor `X-Forwarded-Prefix` and `X-Ingress-Path`. No new field. |

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
2. `basePath` middleware → `req.basePath === '/api/hassio_ingress/abc123'`.
3. EJS render of `pad.html`:
   - `<base href="/api/hassio_ingress/abc123/">`
   - `<link rel="manifest" href="/api/hassio_ingress/abc123/manifest.json">`
   - All `<script>`/`<link>` tags prefixed.
4. `clientVars.basePath = '/api/hassio_ingress/abc123'` sent over socket.io.
5. Client `pad.ts`: `exports.baseURL = '/api/hassio_ingress/abc123/'` → next `socketio.connect` reconnect uses `/api/hassio_ingress/abc123/socket.io/`.
6. `socialMeta`: `og:url = https://ha.example/api/hassio_ingress/abc123/p/scratch`, `og:image = https://ha.example/api/hassio_ingress/abc123/favicon.ico`.
7. Inner ace iframe loads `../static/empty.html` (relative) → resolves to `/api/hassio_ingress/abc123/static/empty.html` naturally. No code change in the inner iframe.

Direct (non-proxied) request — same code path:

1. No `X-Forwarded-Prefix`, no `X-Ingress-Path` → `req.basePath = ''`.
2. EJS render: `<link rel="manifest" href="/manifest.json">`, etc. — every emitted URL identical to today. A new `<base href="/">` tag is added to `<head>`; that's a no-op for absolute URLs and unchanged for the relative URLs already in use. See "Risks" for the fragment-link audit.
3. `clientVars.basePath = ''` → `exports.baseURL = '/'` (today's value).

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

- **`<base href>` retargets in-page fragment links.** With `<base
  href="/foo/">` an `<a href="#chat">` resolves to `/foo/#chat`, which can
  change scroll behavior. Mitigation: every in-template fragment link is
  audited during implementation; if any rely on bare `#` resolution, they're
  rewritten as `href="<%= currentPath %>#chat"` or with `event.preventDefault`
  + JS scroll (already the pattern in `pad.html` chat). To minimize churn we
  only inject `<base>` on pages that don't have problematic fragment usage
  today; the audit is part of the plan.
- **Plugin templates and plugin-rendered HTML** outside `src/templates/` may
  contain leading-slash URLs. We can't auto-rewrite them, but the `<base
  href>` injection covers them at runtime. Documentation will note that
  plugins emitting absolute URLs should prefer relative or `clientVars.basePath`-prefixed
  paths.
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
