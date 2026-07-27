# Issue #7524 — Drop swagger-ui, take a telemetry stance, opt out our phone-homes

**Status:** approved 2026-05-15
**Closes:** [ether/etherpad#7524](https://github.com/ether/etherpad/issues/7524)
**Author:** John McLear (design brainstormed with Claude)
**Branch:** `feature/7524-drop-swagger-ui-telemetry` off `develop`

## Goal

Eliminate the only known third-party telemetry vector in Etherpad's runtime
dependency tree (swagger-ui's Scarf pixel) and give operators explicit,
documented opt-outs for the two outbound calls Etherpad itself makes.

## Background

Etherpad currently ships `swagger-ui-express ^5.0.1` to render the OpenAPI
spec at `/api-docs`. Upstream's npm distribution injects a Scarf analytics
pixel that cannot be disabled at install or runtime (see
[swagger-api/swagger-ui#10573](https://github.com/swagger-api/swagger-ui/issues/10573)).

Etherpad itself makes two outbound calls:

1. `src/node/utils/UpdateCheck.ts` — hourly `GET ${updateServer}/info.json`
   for the admin "update available" notice. No opt-out today.
2. `src/static/js/pluginfw/installer.ts:179` — `GET ${updateServer}/plugins.json`
   on admin-plugins page load (10 min cache). No opt-out today.

Both share the `updateServer` setting (default `https://static.etherpad.org`).
There is no public document stating Etherpad's position on telemetry.

## Out of scope

- Replacing `static.etherpad.org` itself or hosting a mirror.
- Auditing telemetry beyond the two known endpoints.
- Changing `/api-docs.json` (spec endpoint unchanged).
- The admin OpenAPI editor effort (issue #7693, separate PR).

## Deliverables

Three deliverables ship together in one PR closing #7524:

### 1. Replace `swagger-ui-express` with vendored RapiDoc

**Removed:**
- `swagger-ui-express ^5.0.1` from `src/package.json` dependencies.
- `@types/swagger-ui-express ^4.1.8` from `src/package.json` devDependencies.
- `import {serve, setup} from 'swagger-ui-express'` at `src/node/handler/RestAPI.ts:8`.
- The three-line route block at `src/node/handler/RestAPI.ts:1440-1445`
  (`app.use('/api-docs', serve)` + `app.get('/api-docs', setup(...))`).

**Added:**
- `src/static/vendor/rapidoc/rapidoc-min.js` — vendored from
  `https://unpkg.com/rapidoc@9.3.x/dist/rapidoc-min.js` (MIT, ~370KB),
  committed as a static asset. Pinned exact version recorded in
  `src/static/vendor/rapidoc/VERSION`. No CDN fetch at runtime.
- `src/static/api-docs.html` — minimal HTML shell:
  ```html
  <!doctype html><html><head><title>Etherpad API</title>
  <script type="module" src="/static/vendor/rapidoc/rapidoc-min.js"></script>
  </head><body>
  <rapi-doc spec-url="/api-docs.json" theme="light" render-style="read"
            show-header="false" allow-server-selection="false"></rapi-doc>
  </body></html>
  ```
- Route registration that serves `/api-docs` → `api-docs.html` and the
  static asset under `/static/vendor/rapidoc/`. The simplest path is to
  drop the file under `src/static/` and let the existing static-file
  middleware pick it up; if that needs an explicit route, add it next to
  the `/api-docs.json` handler in `RestAPI.ts`.

**Kept (unchanged):**
- `/api-docs.json` route at `RestAPI.ts:1449-1453`.
- `src/node/types/SwaggerUIResource.ts` (TypeScript type used by `openapi.ts`,
  no runtime swagger-ui dependency).
- The unrelated swagger comment at `openapi.ts:810`.

**Verification of clean vendoring:**
Before committing the vendored file, grep it for:
`fetch(`, `XMLHttpRequest`, `sendBeacon`, `scarf`, `googletag`, `analytics`,
`navigator.connection`. Any hit must be reviewed and confirmed as either
same-origin spec loading (legit) or removed. Outcome is documented in the
PR description.

### 2. Privacy opt-out config

**`src/node/utils/Settings.ts` — new block** alongside the existing
`privacyBanner`:

```ts
privacy: {
  updateCheck: boolean,    // default true
  pluginCatalog: boolean,  // default true
},
```

Defaults are `true` so behavior is identical to today; operators flip to
`false` to silence each call. Both default-true keeps the change
non-breaking for existing installs.

**`src/node/utils/UpdateCheck.ts`:**
- `check()` — early-return when `settings.privacy.updateCheck === false`,
  logging once: `Update check disabled by privacy.updateCheck=false`.
  No fetch, no scheduled retry.
- `getLatestVersion()` — returns `undefined` when disabled. The existing
  caller at `src/node/hooks/express/adminsettings.ts:105` already tolerates
  undefined; the admin panel simply omits the "update available" line.

**`src/static/js/pluginfw/installer.ts`:**
- `getAvailablePlugins()` — early-throw when
  `settings.privacy.pluginCatalog === false` with a tagged error:
  `Error('Plugin catalog disabled (privacy.pluginCatalog=false)')`.
- Admin consumer at `src/node/hooks/express/adminplugins.ts` catches this
  specific error and renders a fallback panel: "Plugin catalog is disabled.
  Enter a plugin name to install manually." with a free-text install input.
  `install(pluginName)` itself remains functional — only browsing is gated.

**`bin/plugins/stalePlugins.ts`:**
- Currently hardcodes `https://static.etherpad.org/plugins.full.json`.
  Rewrite to read `settings.updateServer` and respect
  `settings.privacy.pluginCatalog`. When disabled, log and exit 0 (dev
  tool; failing isn't useful).

**`settings.json.template`:**
Add the `privacy` block with comments pointing readers to `PRIVACY.md`.

### 3. `PRIVACY.md` + README link

New `PRIVACY.md` at the repo root, factual and short:

```
# Privacy in Etherpad

## What this document is
A complete, current list of every network call Etherpad's own code
makes to a third party, plus how to turn each one off.

## TL;DR
Etherpad ships with two outbound calls to etherpad.org. Both are
documented below. Both can be disabled with a single config value
each. No analytics, no usage pings, no third-party SDKs at runtime.

## Outbound calls

### 1. Version check
- URL:       https://static.etherpad.org/info.json  (or `updateServer`)
- Frequency: hourly while the server runs
- Payload:   GET only; User-Agent header carries "Etherpad/<version>"
- Purpose:   surface a "update available" notice in the admin panel
- Disable:   set `privacy.updateCheck: false` in settings.json
- Source:    src/node/utils/UpdateCheck.ts

### 2. Plugin catalog
- URL:       https://static.etherpad.org/plugins.json  (or `updateServer`)
- Frequency: on admin-plugins page load (cached 10 min)
- Payload:   GET only; same User-Agent
- Purpose:   list installable ep_* plugins in the admin UI
- Disable:   set `privacy.pluginCatalog: false` in settings.json
             (manual install-by-name still works)
- Source:    src/static/js/pluginfw/installer.ts

## What we removed
swagger-ui-express was dropped in <PR #> because the upstream package
injects a Scarf analytics pixel that cannot be disabled at build or
runtime. /api-docs is now served by a vendored copy of RapiDoc (MIT)
with no outbound calls.

## What we will not add
- usage analytics or telemetry SDKs
- crash reporters that send data without explicit opt-in
- third-party CDN dependencies at runtime
- dependencies whose install or runtime phones home

## Plugins
Third-party plugins are out of this guarantee. Plugins run in your
Etherpad process with full access; audit any plugin you install.

## Reporting
Found an outbound call this doc doesn't list? Open an issue with the
label `privacy`.
```

**`README.md`** — one line near the top under the existing intro:

> Privacy: Etherpad makes two opt-out network calls and ships no third-party
> telemetry. See [PRIVACY.md](PRIVACY.md).

**`CHANGELOG.md`** (or release notes file) — single entry under the new
release section:

> **Privacy:** Dropped `swagger-ui-express` (third-party telemetry);
> `/api-docs` now served by vendored RapiDoc. Added `privacy.updateCheck`
> and `privacy.pluginCatalog` opt-outs. See `PRIVACY.md`.

## Testing

**Backend (vitest, required per project memory):**
- `Settings.test.ts` — `privacy.updateCheck` and `privacy.pluginCatalog`
  default to `true` when not set in `settings.json`.
- New `UpdateCheck.test.ts` — `check()` makes no fetch when
  `privacy.updateCheck === false` (fetch mocked, assert no call).
- New `installer.test.ts` — `getAvailablePlugins()` throws the tagged
  disabled error when `privacy.pluginCatalog === false`.

**Manual smoke (pre-merge, on port 9003):**
1. Start dev server, open `/api-docs` — confirm RapiDoc renders the spec
   and DevTools Network tab shows zero third-party hosts.
2. Set `privacy.updateCheck: false`, restart — confirm no request to
   `static.etherpad.org/info.json` and admin "update available" line is
   absent.
3. Set `privacy.pluginCatalog: false`, open admin plugins — confirm the
   manual install-by-name fallback renders; `ep_align` installs by name.

**Existing e2e:**
Run admin-page Playwright suites; any test that depended on swagger-ui's
specific DOM needs updating to RapiDoc selectors or removing.

**Dependency hygiene:**
- `pnpm install` clean.
- `grep -ri "swagger" src/ --exclude-dir=node_modules` returns only the
  unrelated comment at `openapi.ts:810` and the kept `SwaggerUIResource.ts`
  type.
- `grep -E "fetch\(|XMLHttpRequest|sendBeacon|scarf|google" src/static/vendor/rapidoc/rapidoc-min.js`
  reviewed; results documented in PR description.

## Rollout

- Branch: `feature/7524-drop-swagger-ui-telemetry` off `develop`.
- Single PR closing #7524.
- After push, wait ~20s, run `gh pr checks`. Fix CI failures inline before
  moving on.
- Action all Qodo review comments inline.

## Rollback

All changes are either additive (the `privacy` block, both defaults `true`)
or one-for-one (`swagger-ui-express` → vendored RapiDoc, same URL surface).
Reverting the merge restores prior behavior cleanly.

## Risks

- Operators with proxies fronting `/api-docs` — URL unchanged, transparent.
- API consumers scraping `/api-docs.json` — untouched.
- Custom admin pages that depended on swagger-ui's specific DOM —
  unlikely (core only); will surface in CI.
- RapiDoc upstream eventually adds telemetry — mitigated by vendoring a
  pinned version and re-grepping on each bump.
