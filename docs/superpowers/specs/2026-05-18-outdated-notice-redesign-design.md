# Outdated-version notice redesign

**Issue:** [ether/etherpad#7799](https://github.com/ether/etherpad/issues/7799)
**Date:** 2026-05-18
**Status:** Design

## Problem

The pad-side "Etherpad on this server is severely outdated. Tell your admin." banner is shown to every visitor of every pad, persistently, whenever the running server is at least one major version behind the latest published release. The reporter (a server admin) says:

> "it's inappropriate to inform users of a site about maintenance tasks that they don't understand or have context to resolve. It wastes users' time by having them try and contact me, and it wastes my time by having to respond."

In addition to the social problem, the current implementation triggers on develop checkouts and on minor-only deltas in some upstream-version states, and has been observed intercepting chat-icon clicks (z-index 9999, bottom-right) in plugin test matrices pinned to older cores.

## Goals

1. The notice is shown **only to the pad's first author** (the author whose ID occupies position 0 in the pad's attribute pool — i.e. whoever made the first edit).
2. The notice is **non-persistent**: a dismissable `$.gritter` toast, auto-fading after 8s, rather than an always-visible badge.
3. The notice fires **only on minor-or-more behind** (e.g. 3.1.0 → 3.2.0, 2.7.3 → 3.0.0). Patch-only deltas (3.0.1 → 3.0.2) never fire.
4. The notice never fires when `current >= latest` (covers the develop-after-bump case).
5. The `vulnerable-below` UI is **dropped entirely**, along with the directive parser and state field. The vulnerable enum is gone from the API.

## Non-goals

- No new settings flag. `updates.tier = 'off'` remains the kill-switch.
- No translations of new strings in this PR. A `TODO(i18n)` placeholder is carried forward — strings are hard-coded English, mirroring the current state of the badge code. A follow-up adds `pad.outdatedNotice.*` keys once the html10n key set is set up to be shared with the pad-side bundle.

## Architecture

```
Browser (pad load, after CLIENT_VARS)         Server
─────────────────────────────────────         ──────
pad.ts → maybeShowOutdatedNotice()
            │
            ├─ GET /api/version-status?padId=<id>      (cookies: express_sid)
            │
            │                              loadState(stateFilePath())
            │                                │
            │                                ├─ no latest                  → {outdated:null,isFirstAuthor:false}
            │                                ├─ current >= latest          → {outdated:null,isFirstAuthor:false}
            │                                ├─ same major + minor differs → next step
            │                                ├─ major differs              → next step
            │                                └─ patch-only behind          → {outdated:null,isFirstAuthor:false}
            │                                next step:
            │                                  resolve req-author via express_sid
            │                                  load pad → firstAuthor = pool position 0
            │                                  if req-author === firstAuthor
            │                                    return {outdated:'minor',isFirstAuthor:true}
            │                                  else
            │                                    return {outdated:null,isFirstAuthor:false}
            │
            ├─ outdated:'minor' && isFirstAuthor
            │    → $.gritter.add({class_name:'outdated-notice', position:'bottom',
            │                     sticky:false, time:8000, title, text})
            └─ else
                 → no-op
```

The endpoint shape collapses to a single enum (`'minor' | null`) plus a per-request `isFirstAuthor` boolean. The server never returns a positive `outdated` value to a non-first-author requester — there is no client-side "the answer is minor, but show it conditionally" path. Operational signal does not leak to ordinary pad visitors.

## Server changes

### `src/node/updater/versionCompare.ts`

- **Add** `isMinorOrMoreBehind(current: string, latest: string): boolean` — `true` iff `parseSemver(current).major < parseSemver(latest).major`, or majors equal and `current.minor < latest.minor`. Patch-only delta returns `false`. Returns `false` on parse failure of either side.
- **Delete** `isMajorBehind`, `isVulnerable`, `parseVulnerableBelow`, the `VULN_RE` regex, and the `VulnerableBelowDirective` import.

### `src/node/updater/types.ts`

- **Delete** `VulnerableBelowDirective`.
- **Delete** `UpdaterState.vulnerableBelow` field.

### `src/node/updater/state.ts`

- Stop reading and stop writing `vulnerableBelow`. Existing state files with the field still parse — the loader ignores unknown keys. No migration needed; the field naturally drops on next write.

### `src/node/updater/VersionChecker.ts`

- Remove the release-notes scraping that called `parseVulnerableBelow`. The rest of the check (current vs latest tag) is unchanged.

### `src/node/hooks/express/updateStatus.ts` (load-bearing change)

```ts
interface OutdatedResponse {
  outdated: 'minor' | null;
  isFirstAuthor: boolean;
}

const EMPTY: OutdatedResponse = {outdated: null, isFirstAuthor: false};

const cache = new LRU<string, {value: OutdatedResponse; at: number}>(1000);
const inFlight = new Map<string, Promise<OutdatedResponse>>();
const TTL_MS = 60 * 1000;

const firstAuthorOf = (pad: Pad): string | null => {
  const num2attrib = pad.pool.numToAttrib;
  const keys = Object.keys(num2attrib).map(Number).sort((a, b) => a - b);
  for (const k of keys) {
    const a = num2attrib[k];
    if (a && a[0] === 'author' && typeof a[1] === 'string' && a[1] !== '') return a[1];
  }
  return null;
};

const computeOutdated = async (padId: string | null, authorId: string | null): Promise<OutdatedResponse> => {
  const state = await loadState(stateFilePath());
  if (!state.latest) return EMPTY;
  const current = getEpVersion();
  if (!isMinorOrMoreBehind(current, state.latest.version)) return EMPTY;
  if (!padId || !authorId) return EMPTY;
  if (!(await padManager.doesPadExist(padId))) return EMPTY;
  const pad = await padManager.getPad(padId, null);
  if (firstAuthorOf(pad) !== authorId) return EMPTY;
  return {outdated: 'minor', isFirstAuthor: true};
};

app.get('/api/version-status', wrapAsync(async (req, res) => {
  const padId = typeof req.query.padId === 'string' ? req.query.padId : null;
  const authorId = await resolveRequestAuthor(req);   // express_sid → session → author, null on miss
  const key = `${padId ?? ''}|${authorId ?? ''}`;
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now - hit.at <= TTL_MS) {
    res.json(hit.value);
    return;
  }
  let flight = inFlight.get(key);
  if (!flight) {
    flight = computeOutdated(padId, authorId).finally(() => inFlight.delete(key));
    inFlight.set(key, flight);
  }
  const value = await flight;
  cache.set(key, {value, at: now});
  res.json(value);
}));
```

- `resolveRequestAuthor(req)` is a small helper that reads `req.cookies.express_sid`, calls `sessionStore.get(sid)` (the same store used by the express-session middleware), and returns `session?.user?.author ?? null`. On any failure path it returns `null` — the request is then treated as anonymous and gets `EMPTY`.
- `padId` is validated through `padutils.validateRequest({padID: padId})` before being passed to `padManager`. Validation failures map to `EMPTY`, not 400 — keeping the endpoint quiet about whether the pad exists.
- LRU cap of 1000 entries bounds memory on busy servers; entries expire by TTL anyway.
- Single-flight per cache key collapses bursts at expiry into one disk read.
- `_resetBadgeCacheForTests()` clears both `cache` and `inFlight`.

### `src/node/hooks/express/openapi-admin.ts`

- Update the OpenAPI doc for `/api/version-status`:
  - Add `padId` query parameter (string, optional, must match Etherpad's pad-id format).
  - Update response schema: `{outdated: 'minor' | null, isFirstAuthor: boolean}`.
  - Drop the `severe` and `vulnerable` enum values.

## Client changes

### `src/templates/pad.html`

- Delete line 648 (`<div id="version-badge" role="status" aria-live="polite" style="display:none"></div>`).

### `src/static/css/pad.css`

- Delete the `#version-badge { … }` rule block (lines ~119–131). Gritter's stock styling carries the notice; no new CSS is added — matches `.privacy-notice` precedent.

### `src/static/js/pad_version_badge.ts` → renamed to `pad_outdated_notice.ts`

```ts
'use strict';

interface OutdatedResponse {
  outdated: 'minor' | null;
  isFirstAuthor: boolean;
}

const apiBasePath = (): string => {
  if (typeof window === 'undefined') return '/';
  return new URL('..', window.location.href).pathname;
};

const currentPadId = (): string | null => {
  const id = (window as any).clientVars?.padId;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

export const maybeShowOutdatedNotice = async (): Promise<void> => {
  const padId = currentPadId();
  if (!padId) return;
  const $ = (window as any).$;
  if (!$ || !$.gritter || typeof $.gritter.add !== 'function') return;

  try {
    const url = `${apiBasePath()}api/version-status?padId=${encodeURIComponent(padId)}`;
    const res = await fetch(url, {credentials: 'same-origin'});
    if (!res.ok) return;
    const data = (await res.json()) as OutdatedResponse;
    if (data.outdated !== 'minor' || !data.isFirstAuthor) return;

    // TODO(i18n): switch to html10n once `pad.outdatedNotice.*` keys land.
    $.gritter.add({
      title: 'Etherpad update available',
      text: 'A newer version of Etherpad has been released. Consider updating this server.',
      sticky: false,
      position: 'bottom',
      class_name: 'outdated-notice',
      time: 8000,
    });
  } catch {
    /* never block pad load */
  }
};
```

- Module no longer self-bootstraps on `DOMContentLoaded`; it needs `clientVars.padId`, which is only present after `CLIENT_VARS` arrives.
- Invocation site: `src/static/js/pad.ts`, in the same post-`handleClientVars` block where `showPrivacyBannerIfEnabled` is called.
- No `localStorage` write — dismissal is per-session (gritter X-click clears DOM; reload re-fetches and re-shows if still outdated).

## Tests

### Backend — `src/tests/backend/specs/api/updateStatus.spec.ts` (rewrite affected blocks)

- Drop `describe('vulnerable …')` cases entirely.
- Replace `describe('severe / isMajorBehind …')` with `describe('isMinorOrMoreBehind …')` covering:
  - patch-only delta returns `false` (2.7.3 vs 2.7.4)
  - minor delta returns `true` (2.7.3 vs 2.8.0)
  - major delta returns `true` (2.7.3 vs 3.0.0)
  - equal versions return `false`
  - current newer than latest returns `false` (develop-on-bumped-package.json case)
  - unparseable input on either side returns `false`
- New `describe('GET /api/version-status')` cases:
  - no `state.latest` → `{outdated:null,isFirstAuthor:false}`
  - current ≥ latest, with valid padId+author → `EMPTY`
  - padId omitted → `EMPTY` (no leak)
  - authorId resolves but isn't pool position 0 → `EMPTY`
  - current is minor-behind AND requester is pool position 0 → `{outdated:'minor',isFirstAuthor:true}`
  - current is patch-behind, requester IS pool position 0 → `EMPTY`
  - cache hit within 60s for same `padId|authorId` does NOT re-call `loadState` (spy assertion)
  - two different `padId|authorId` pairs are cached independently
  - with the LRU cap forced low (test-only setter), the oldest entry is evicted first

Each case calls `_resetBadgeCacheForTests()` in `beforeEach`.

### Backend — `firstAuthorOf` unit test (new file next to the helper)

- empty pad → `null`
- single-author pad → that author
- A edited first then B → A
- pool with non-author attribs interleaved at low numeric keys → still returns the lowest `['author', X]`
- pool with `['author', '']` placeholder → skipped; returns the next real author

### Frontend — `src/tests/frontend-new/specs/outdated_notice.spec.ts` (new, mirrors `privacy_banner.spec.ts`)

- stub `/api/version-status` to `{outdated:null,…}` → no `.gritter-item.outdated-notice` after pad load
- stub to `{outdated:'minor', isFirstAuthor:false}` → no gritter (client belt-and-braces guard)
- stub to `{outdated:'minor', isFirstAuthor:true}` → `.gritter-item.outdated-notice` appears, body text matches, dismisses on X-click
- stub returning 500 → no DOM injection, no user-visible console error
- after ~9s with positive stub → gritter auto-faded (asserts `sticky:false` + `time:8000` wiring)

### Files removed entirely

- Any standalone `versionBadge.spec.ts` fixture file (merged into `updateStatus.spec.ts`).
- Any fixture referencing `vulnerableBelow`.

### Verification gates (mandatory before claiming done)

- `pnpm --filter ep_etherpad-lite test:vitest` clean (backend).
- `pnpm exec playwright test outdated_notice` clean under `xvfb-run` (frontend).
- Manual: load a pad on the dev server (`http://localhost.lan:9003/p/test`) with `var/update.state.json` pinned to a higher `latest.version` — gritter appears once for first-author in incognito-A, absent in incognito-B (second visitor).

## Docs / settings / build

- `doc/api/http_api.md` (and `.adoc` if present) — update `/api/version-status` entry: new shape, new `padId` query param, note that positive results are scoped to first-author.
- `doc/api/updater.md` (or the relevant `updates.tier` section in `doc/settings.md`) — drop the paragraph(s) on the vulnerable-below directive and the persistent banner UI.
- `CHANGELOG.md` (Unreleased) — one entry: "Outdated-version notice redesigned per #7799 — transient gritter, first-author only, minor-or-major behind only. The persistent banner, `severe` enum, and `vulnerable-below` directive scraping are removed."
- No settings-schema changes. `updates.tier = 'off'` remains the full kill-switch.
- `vite.config.ts` (and any other bundle config) — rename `pad_version_badge` entries to `pad_outdated_notice`. Grep to confirm no admin-bundle reference exists (shouldn't; pad-only).

## Risk / open questions

- **Develop-on-stale-package.json.** Today develop's `package.json` reads `2.7.3` while the latest npm release is newer. Under this design, the notice still triggers on develop because `current < latest`. The expected operational practice is for the post-release bump of develop's `package.json` to a higher pre-release identifier to short-circuit this naturally. Documented in the CHANGELOG entry. If maintainers want belt-and-braces, a follow-up can add a `.git`-presence short-circuit, but that is explicitly out-of-scope here per the design decision.
- **First-author churn on imported pads.** If a pad was created via `setText`/API by an admin script using a service-account author, the first-author signal points at that service account. Operationally fine — the notice just won't fire for anyone. Acceptable.
- **Anonymous browsers without express_sid.** First load of a pad with no prior session has no `express_sid` cookie until `socket.io` connects. The version-status request fires after `CLIENT_VARS`, which is after the socket handshake, so by then the cookie exists. If for any reason it doesn't, `resolveRequestAuthor` returns `null` and the response is `EMPTY` — fail-quiet.
