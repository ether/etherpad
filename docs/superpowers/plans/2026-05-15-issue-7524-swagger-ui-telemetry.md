# Issue #7524 — Drop swagger-ui + privacy opt-outs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `swagger-ui-express` with vendored RapiDoc, add `privacy.updateCheck` and `privacy.pluginCatalog` opt-outs for Etherpad's two outbound calls, and publish a `PRIVACY.md` stance.

**Architecture:** Three coordinated changes on one branch. (1) Settings.ts gains a `privacy` block; `UpdateCheck.ts` and `installer.ts` early-return when their respective flag is `false`. (2) `swagger-ui-express` is removed; `/api-docs` is served by a vendored RapiDoc web component (`<rapi-doc>`) loading `/api-docs.json`. (3) `PRIVACY.md` documents what calls home and how to disable each.

**Tech Stack:** TypeScript, Node 25, Express 5, pnpm workspaces, vitest (backend), Playwright (e2e), React 19 (admin), RapiDoc 9.x (vendored).

**Spec:** `docs/superpowers/specs/2026-05-15-issue-7524-swagger-ui-telemetry-design.md`

**Branch:** `feature/7524-drop-swagger-ui-telemetry` off `develop` (already created).

---

## File Map

**Modified:**
- `src/package.json` — drop `swagger-ui-express`, `@types/swagger-ui-express`.
- `src/node/utils/Settings.ts` — add `privacy` field to interface + default.
- `src/node/utils/UpdateCheck.ts` — early-return in `check()` and `getLatestVersion()` when disabled.
- `src/static/js/pluginfw/installer.ts` — throw tagged error in `getAvailablePlugins()` when disabled.
- `src/node/hooks/express/adminplugins.ts` — check the setting before catalog calls; emit `results:catalogDisabled`.
- `bin/plugins/stalePlugins.ts` — read `settings.updateServer`, respect `privacy.pluginCatalog`.
- `src/node/handler/RestAPI.ts` — drop swagger-ui import + route block; serve `api-docs.html`.
- `settings.json.template` — add `privacy` block.
- `admin/src/pages/HomePage.tsx` — subscribe to `results:catalogDisabled`, render banner.
- `admin/src/localization/en.json` (and any keyed locales) — new banner strings.
- `README.md` — one-line privacy mention.
- `CHANGELOG.md` — single bullet.

**Created:**
- `src/static/vendor/rapidoc/rapidoc-min.js` — vendored asset (~370KB).
- `src/static/vendor/rapidoc/VERSION` — pinned version string + checksum.
- `src/static/vendor/rapidoc/LICENSE` — RapiDoc MIT license copy.
- `src/static/api-docs.html` — minimal RapiDoc shell.
- `src/tests/backend-new/specs/privacy/settings-defaults.test.ts` — `privacy` defaults.
- `src/tests/backend-new/specs/privacy/updateCheck-optout.test.ts` — no fetch when off.
- `src/tests/backend-new/specs/privacy/installer-optout.test.ts` — throws when off.
- `PRIVACY.md` — repo-root stance doc.

**Unchanged but cross-referenced:**
- `src/node/server.ts:114` — calls `check()`; behavior gated inside `UpdateCheck.ts`.
- `src/node/hooks/express/adminsettings.ts:105` — calls `getLatestVersion()`; tolerates undefined.
- `src/node/types/SwaggerUIResource.ts` — TypeScript-only, no runtime swagger-ui.
- `src/node/handler/RestAPI.ts:1449-1453` — `/api-docs.json` route untouched.

---

## Task 1: Add `privacy` shape to Settings (TDD)

**Files:**
- Modify: `src/node/utils/Settings.ts:184` (interface) and `src/node/utils/Settings.ts:419` (defaults, next to `privacyBanner`)
- Create: `src/tests/backend-new/specs/privacy/settings-defaults.test.ts`

- [ ] **Step 1: Create the failing test**

Create `src/tests/backend-new/specs/privacy/settings-defaults.test.ts`:

```typescript
import {describe, it, expect} from 'vitest';
import settings from '../../../../node/utils/Settings';

describe('privacy settings defaults', () => {
  it('privacy.updateCheck defaults to true', () => {
    expect(settings.privacy.updateCheck).toBe(true);
  });

  it('privacy.pluginCatalog defaults to true', () => {
    expect(settings.privacy.pluginCatalog).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src && pnpm test:vitest -- tests/backend-new/specs/privacy/settings-defaults.test.ts
```

Expected: FAIL with `Cannot read properties of undefined (reading 'updateCheck')` or TS compile error referencing `privacy`.

- [ ] **Step 3: Add `privacy` to the SettingsType interface**

In `src/node/utils/Settings.ts`, find the interface block containing `privacyBanner: { ... }` (around line 189). Immediately after the closing `}` of `privacyBanner`, add:

```typescript
  privacy: {
    updateCheck: boolean,
    pluginCatalog: boolean,
  },
```

- [ ] **Step 4: Add the default value**

In `src/node/utils/Settings.ts`, find the defaults object containing `privacyBanner: { enabled: false, ... }` (around line 419). Immediately after the closing `}` of that `privacyBanner` default, add:

```typescript
  privacy: {
    // Outbound calls. See PRIVACY.md.
    // Set to false to disable hourly version check (UpdateCheck.ts).
    updateCheck: true,
    // Set to false to disable plugin-catalog fetch from updateServer
    // (installer.ts). Manual install via CLI still works.
    pluginCatalog: true,
  },
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd src && pnpm test:vitest -- tests/backend-new/specs/privacy/settings-defaults.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/node/utils/Settings.ts src/tests/backend-new/specs/privacy/settings-defaults.test.ts
git commit -m "feat(privacy): add privacy block to settings shape

Adds privacy.updateCheck and privacy.pluginCatalog, both defaulting to
true so behavior is unchanged until operators opt out.

Refs #7524"
```

---

## Task 2: UpdateCheck opt-out (TDD)

**Files:**
- Modify: `src/node/utils/UpdateCheck.ts`
- Create: `src/tests/backend-new/specs/privacy/updateCheck-optout.test.ts`

- [ ] **Step 1: Create the failing test**

Create `src/tests/backend-new/specs/privacy/updateCheck-optout.test.ts`:

```typescript
import {describe, it, expect, beforeEach, vi} from 'vitest';
import settings from '../../../../node/utils/Settings';

describe('UpdateCheck opt-out', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('check() does not call fetch when privacy.updateCheck is false', async () => {
    settings.privacy.updateCheck = false;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {status: 200})
    );
    const {check} = await import('../../../../node/utils/UpdateCheck');
    check();
    // Allow any internal microtasks to settle.
    await new Promise((r) => setImmediate(r));
    expect(fetchSpy).not.toHaveBeenCalled();
    settings.privacy.updateCheck = true;
  });

  it('check() calls fetch when privacy.updateCheck is true', async () => {
    settings.privacy.updateCheck = true;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({latestVersion: '99.0.0'}), {status: 200})
    );
    const {check} = await import('../../../../node/utils/UpdateCheck');
    check();
    await new Promise((r) => setImmediate(r));
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src && pnpm test:vitest -- tests/backend-new/specs/privacy/updateCheck-optout.test.ts
```

Expected: FAIL — first test fails because `check()` still calls fetch.

- [ ] **Step 3: Gate `check()` and `getLatestVersion()`**

Replace the contents of `src/node/utils/UpdateCheck.ts` with:

```typescript
'use strict';
import semver from 'semver';
import settings, {getEpVersion} from './Settings';
const headers = {
  'User-Agent': 'Etherpad/' + getEpVersion(),
}

type Infos = {
  latestVersion: string
}


const updateInterval = 60 * 60 * 1000; // 1 hour
let infos: Infos;
let lastLoadingTime: number | null = null;
let loggedDisabled = false;

const loadEtherpadInformations = () => {
  if (lastLoadingTime !== null && Date.now() - lastLoadingTime < updateInterval) {
    return infos;
  }

  return fetch(`${settings.updateServer}/info.json`, {headers})
  .then(async (resp) => {
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    infos = await resp.json() as Infos;
    if (infos === undefined || infos === null) {
      await Promise.reject("Could not retrieve current version")
      return
    }

    lastLoadingTime = Date.now();
    return infos;
  })
  .catch(async (err: Error) => {
    throw err;
  });
}


export const getLatestVersion = () => {
  if (!settings.privacy.updateCheck) return undefined;
  needsUpdate().catch();
  return infos?.latestVersion;
};

const needsUpdate = async (cb?: Function) => {
  try {
    const info = await loadEtherpadInformations()
    if (semver.gt(info!.latestVersion, getEpVersion())) {
      if (cb) return cb(true);
    }
  } catch (err) {
    console.error(`Can not perform Etherpad update check: ${err}`);
    if (cb) return cb(false);
  }
};

export const check = () => {
  if (!settings.privacy.updateCheck) {
    if (!loggedDisabled) {
      console.info('Update check disabled by privacy.updateCheck=false (see PRIVACY.md)');
      loggedDisabled = true;
    }
    return;
  }
  needsUpdate((needsUpdate: boolean) => {
    if (needsUpdate) {
      console.warn(`Update available: Download the actual version ${infos.latestVersion}`);
    }
  }).then(()=>{});
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd src && pnpm test:vitest -- tests/backend-new/specs/privacy/updateCheck-optout.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/node/utils/UpdateCheck.ts src/tests/backend-new/specs/privacy/updateCheck-optout.test.ts
git commit -m "feat(privacy): honour privacy.updateCheck=false in UpdateCheck

check() and getLatestVersion() now early-return when the setting is
off. Logs once on first skip. The admin 'update available' panel
already tolerates an undefined latestVersion.

Refs #7524"
```

---

## Task 3: Plugin installer opt-out (TDD)

**Files:**
- Modify: `src/static/js/pluginfw/installer.ts:171-197`
- Create: `src/tests/backend-new/specs/privacy/installer-optout.test.ts`

- [ ] **Step 1: Create the failing test**

Create `src/tests/backend-new/specs/privacy/installer-optout.test.ts`:

```typescript
import {describe, it, expect, beforeEach, vi} from 'vitest';
import settings from '../../../../node/utils/Settings';

describe('Plugin installer opt-out', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('getAvailablePlugins throws tagged error when privacy.pluginCatalog is false', async () => {
    settings.privacy.pluginCatalog = false;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const {getAvailablePlugins} = await import(
      '../../../../static/js/pluginfw/installer'
    );
    await expect(getAvailablePlugins(false)).rejects.toThrow(
      /privacy\.pluginCatalog=false/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    settings.privacy.pluginCatalog = true;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src && pnpm test:vitest -- tests/backend-new/specs/privacy/installer-optout.test.ts
```

Expected: FAIL — fetch is still called; no error thrown.

- [ ] **Step 3: Guard `getAvailablePlugins()`**

In `src/static/js/pluginfw/installer.ts`, replace the body of `getAvailablePlugins` (currently lines ~171-197) with:

```typescript
export const getAvailablePlugins = async (maxCacheAge: number | false) => {
  if (!settings.privacy.pluginCatalog) {
    throw new Error('Plugin catalog disabled by privacy.pluginCatalog=false (see PRIVACY.md)');
  }

  const nowTimestamp = Math.round(Date.now() / 1000);

  // check cache age before making any request
  if (availablePlugins && maxCacheAge && (nowTimestamp - cacheTimestamp) <= maxCacheAge) {
    return availablePlugins;
  }

  const pluginsLoaded = await fetch(`${settings.updateServer}/plugins.json`, {headers});
  if (!pluginsLoaded.ok) {
    throw new Error(`HTTP ${pluginsLoaded.status} ${pluginsLoaded.statusText}`);
  }
  const data = await pluginsLoaded.json() as MapArrayType<PackageInfo>;
  // Normalize: the registry may use numeric keys instead of plugin names
  const normalized: MapArrayType<PackageInfo> = {};
  for (const key in data) {
    const entry = data[key];
    if (entry && entry.name) {
      normalized[entry.name] = entry;
    } else {
      normalized[key] = entry;
    }
  }
  availablePlugins = normalized;
  cacheTimestamp = nowTimestamp;
  return availablePlugins;
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd src && pnpm test:vitest -- tests/backend-new/specs/privacy/installer-optout.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/static/js/pluginfw/installer.ts src/tests/backend-new/specs/privacy/installer-optout.test.ts
git commit -m "feat(privacy): honour privacy.pluginCatalog=false in installer

getAvailablePlugins() throws a tagged disabled error before any fetch
when the setting is off. install/uninstall paths are unaffected so
operators can still install plugins by name via CLI.

Refs #7524"
```

---

## Task 4: Surface catalog-disabled in admin socket handler

**Files:**
- Modify: `src/node/hooks/express/adminplugins.ts:47-100`

- [ ] **Step 1: Update socket handlers**

In `src/node/hooks/express/adminplugins.ts`, import settings at the top of the file (after the existing imports around line 13):

```typescript
import settings from '../../utils/Settings';
```

Then in each of `getInstalled`, `checkUpdates`, `getAvailable`, and `search` socket handlers, add an early branch. For `getInstalled` (around line 47), wrap the `checkPluginForUpdates()` call:

```typescript
    socket.on('getInstalled', async (query: string) => {
      // send currently installed plugins
      const installed =
        Object.keys(pluginDefs.plugins).map((plugin) => pluginDefs.plugins[plugin].package);

      if (settings.privacy.pluginCatalog) {
        const updatable = await checkPluginForUpdates();
        installed.forEach((plugin) => {
          plugin.updatable = updatable.includes(plugin.name);
        })
      }
      // When the catalog is disabled, `updatable` simply stays undefined on
      // each installed plugin — the admin UI renders no "update available"
      // badge, which is correct.

      socket.emit('results:installed', {installed});
    });
```

For `checkUpdates` (around line 62):

```typescript
    socket.on('checkUpdates', async () => {
      if (!settings.privacy.pluginCatalog) {
        socket.emit('results:catalogDisabled');
        return;
      }
      try {
        const updatable = checkPluginForUpdates();
        socket.emit('results:updatable', {updatable});
      } catch (err) {
        const errc = err as ErrorCaused
        console.warn(errc.stack || errc.toString());
        socket.emit('results:updatable', {updatable: {}});
      }
    });
```

For `getAvailable` (around line 76):

```typescript
    socket.on('getAvailable', async (query:string) => {
      if (!settings.privacy.pluginCatalog) {
        socket.emit('results:catalogDisabled');
        return;
      }
      try {
        const results = await getAvailablePlugins(/* maxCacheAge:*/ false);
        socket.emit('results:available', results);
      } catch (er) {
        console.error(er);
        socket.emit('results:available', {});
      }
    });
```

For `search` (around line 86):

```typescript
    socket.on('search', async (query: QueryType) => {
      if (!settings.privacy.pluginCatalog) {
        socket.emit('results:catalogDisabled');
        return;
      }
      try {
        if (query.searchTerm) logger.info(`Plugin search: ${query.searchTerm}'`);
        const results = await search(query.searchTerm, /* maxCacheAge:*/ 60 * 10);
        let res = Object.keys(results)
            .map((pluginName) => results[pluginName])
            .filter((plugin) => !pluginDefs.plugins[plugin.name]);
        res = sortPluginList(res, query.sortBy, query.sortDir)
            .slice(query.offset, query.offset + query.limit);
        socket.emit('results:search', {results: res, query});
      } catch (err: any) {
        logger.error(`Error searching plugins: ${err}`);
        socket.emit('results:searcherror', {error: err.message, query});
      }
    });
```

- [ ] **Step 2: Sanity-build TypeScript**

```bash
cd src && pnpm exec tsc --noEmit
```

Expected: no errors related to adminplugins.ts.

- [ ] **Step 3: Commit**

```bash
git add src/node/hooks/express/adminplugins.ts
git commit -m "feat(privacy): emit results:catalogDisabled when pluginCatalog off

Short-circuits the four catalog-driven socket events. The install/
uninstall events are untouched so operators can still install by
plugin name when the catalog is disabled.

Refs #7524"
```

---

## Task 5: stalePlugins CLI respects opt-out

**Files:**
- Modify: `bin/plugins/stalePlugins.ts:9`

- [ ] **Step 1: Read current state**

```bash
head -20 bin/plugins/stalePlugins.ts
```

Expected: line 9 contains `fetch('https://static.etherpad.org/plugins.full.json')`.

- [ ] **Step 2: Make it honour settings**

In `bin/plugins/stalePlugins.ts`, replace the hardcoded fetch with a settings-aware call. At the top of the file (after existing imports), add:

```typescript
import settings from '../../src/node/utils/Settings';
```

Then replace the line:

```typescript
  const resp = await fetch('https://static.etherpad.org/plugins.full.json');
```

with:

```typescript
  if (!settings.privacy.pluginCatalog) {
    console.info('stalePlugins: plugin catalog disabled by privacy.pluginCatalog=false; exiting');
    process.exit(0);
  }
  const resp = await fetch(`${settings.updateServer}/plugins.full.json`);
```

- [ ] **Step 3: Smoke-run the CLI**

```bash
node --import tsx bin/plugins/stalePlugins.ts --help 2>&1 | head -10
```

Expected: the script starts and either prints help or its normal output. No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add bin/plugins/stalePlugins.ts
git commit -m "fix(bin): stalePlugins reads updateServer and honours privacy flag

Was hardcoding static.etherpad.org and ignoring opt-out. Now exits 0
cleanly when privacy.pluginCatalog=false.

Refs #7524"
```

---

## Task 6: settings.json.template

**Files:**
- Modify: `settings.json.template:418` (add block after `updateServer` line)

- [ ] **Step 1: Insert the new block**

In `settings.json.template`, find the existing `"updateServer": "https://etherpad.org/ep_infos",` line. Add the following block immediately after it:

```jsonc
  /*
   * Outbound network calls. See PRIVACY.md for what each one sends.
   *  - updateCheck=false  : disables hourly version check (UpdateCheck.ts)
   *  - pluginCatalog=false: disables admin plugin browser
   *                        (manual install-by-name via CLI still works)
   */
  "privacy": {
    "updateCheck": true,
    "pluginCatalog": true
  },
```

- [ ] **Step 2: Validate JSONC syntax**

```bash
node -e "const {parse} = require('jsonc-parser'); const errors = []; const data = parse(require('fs').readFileSync('settings.json.template', 'utf8'), errors); if (errors.length) { console.error(errors); process.exit(1); } console.log('privacy:', data.privacy); "
```

Expected: prints `privacy: { updateCheck: true, pluginCatalog: true }`. No errors.

- [ ] **Step 3: Commit**

```bash
git add settings.json.template
git commit -m "docs(settings): document privacy block in settings template

Refs #7524"
```

---

## Task 7: Drop swagger-ui-express dependency

**Files:**
- Modify: `src/package.json:86, 122`

- [ ] **Step 1: Remove the two dep lines**

In `src/package.json`, delete the line:
```
    "swagger-ui-express": "^5.0.1",
```

And in the devDependencies block, delete the line:
```
    "@types/swagger-ui-express": "^4.1.8",
```

- [ ] **Step 2: Refresh the lockfile**

```bash
pnpm install
```

Expected: lockfile updates; `swagger-ui-express` and `swagger-ui-dist` no longer appear.

- [ ] **Step 3: Confirm dependency is gone**

```bash
grep -c "swagger-ui" pnpm-lock.yaml
```

Expected: `0`.

- [ ] **Step 4: Commit (do not commit yet — the import in RestAPI.ts still references it; Task 8 fixes that)**

Skip commit until Task 8 lands so the tree is buildable between commits.

---

## Task 8: Replace swagger-ui-express route with RapiDoc shell

**Files:**
- Modify: `src/node/handler/RestAPI.ts:8, 1440-1445`
- Create: `src/static/api-docs.html`

- [ ] **Step 1: Remove the swagger-ui import**

In `src/node/handler/RestAPI.ts`, delete the line:

```typescript
import {serve, setup} from 'swagger-ui-express'
```

- [ ] **Step 2: Replace the route block**

In `src/node/handler/RestAPI.ts`, replace lines 1440-1445 (the `app.use('/api-docs', serve)` / `app.get('/api-docs', setup(...))` block) with:

```typescript
  app.get('/api-docs', (_req, res) => {
    res.sendFile('api-docs.html', {root: 'src/static'});
  });
```

The `/api-docs.json` route immediately below stays untouched.

- [ ] **Step 3: Create the RapiDoc shell**

Create `src/static/api-docs.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Etherpad API</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <script type="module" src="/static/vendor/rapidoc/rapidoc-min.js"></script>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; }
      rapi-doc { height: 100vh; }
    </style>
  </head>
  <body>
    <rapi-doc
      spec-url="/api-docs.json"
      theme="light"
      render-style="read"
      show-header="false"
      allow-server-selection="false"
      allow-authentication="true"
    ></rapi-doc>
  </body>
</html>
```

- [ ] **Step 4: TypeScript build sanity**

```bash
cd src && pnpm exec tsc --noEmit
```

Expected: no `swagger-ui-express` related errors. (Vendored RapiDoc is referenced by URL from the browser, not imported.)

- [ ] **Step 5: Commit (deps + route swap together)**

```bash
git add src/package.json pnpm-lock.yaml src/node/handler/RestAPI.ts src/static/api-docs.html
git commit -m "feat(api-docs): replace swagger-ui-express with RapiDoc shell

Drops the swagger-ui-express dep (third-party telemetry via Scarf,
see swagger-api/swagger-ui#10573) and serves /api-docs with a static
HTML shell that mounts <rapi-doc>. /api-docs.json is unchanged.

The vendored RapiDoc asset is added in the next commit so the tree is
broken for one diff hunk — pair this with the rapidoc-min.js commit
during review.

Refs #7524"
```

---

## Task 9: Vendor RapiDoc as a static asset

**Files:**
- Create: `src/static/vendor/rapidoc/rapidoc-min.js`
- Create: `src/static/vendor/rapidoc/VERSION`
- Create: `src/static/vendor/rapidoc/LICENSE`

- [ ] **Step 1: Download a pinned RapiDoc release**

```bash
mkdir -p src/static/vendor/rapidoc
curl -fsSL -o src/static/vendor/rapidoc/rapidoc-min.js \
  https://unpkg.com/rapidoc@9.3.4/dist/rapidoc-min.js
curl -fsSL -o src/static/vendor/rapidoc/LICENSE \
  https://raw.githubusercontent.com/rapi-doc/RapiDoc/main/LICENSE.txt
```

Expected: both files present. Confirm size of `rapidoc-min.js` is roughly 300-400KB.

```bash
ls -lah src/static/vendor/rapidoc/
```

- [ ] **Step 2: Record version + checksum**

```bash
( echo "rapidoc 9.3.4 — vendored 2026-05-15"; \
  echo "source: https://unpkg.com/rapidoc@9.3.4/dist/rapidoc-min.js"; \
  echo "sha256: $(sha256sum src/static/vendor/rapidoc/rapidoc-min.js | cut -d' ' -f1)" ) \
  > src/static/vendor/rapidoc/VERSION
cat src/static/vendor/rapidoc/VERSION
```

Expected: file contains version, source URL, sha256.

- [ ] **Step 3: Telemetry grep audit**

```bash
grep -E "scarf|google-analytics|googletagmanager|sentry|datadog|segment\.|mixpanel|amplitude|navigator\.sendBeacon" \
  src/static/vendor/rapidoc/rapidoc-min.js || echo "no known telemetry strings"
```

Expected: prints `no known telemetry strings`. If anything matches, stop and investigate before continuing.

- [ ] **Step 4: Outbound-fetch surface audit**

```bash
grep -oE "https?://[a-zA-Z0-9./_-]+" src/static/vendor/rapidoc/rapidoc-min.js \
  | sort -u | head -40
```

Expected: only references to schema/spec URLs (e.g. `swagger.io/specification` for OpenAPI schema validation in comments) and same-origin path templates. No analytics hosts. Document the output in the PR description.

- [ ] **Step 5: Manual smoke**

```bash
cd src && pnpm dev &
SERVER_PID=$!
sleep 8
curl -fsSL -o /tmp/api-docs.html http://localhost:9001/api-docs
grep -c "rapi-doc" /tmp/api-docs.html
kill $SERVER_PID
```

Expected: `/api-docs` returns the HTML shell containing `<rapi-doc>`; count is at least 1. Then open it in a real browser:

```bash
cd src && pnpm dev
# In another shell:
# xdg-open http://localhost:9001/api-docs
```

Verify in the browser: spec renders, no third-party hosts in DevTools Network tab (only `localhost`). Close server when done.

- [ ] **Step 6: Commit**

```bash
git add src/static/vendor/rapidoc/
git commit -m "feat(api-docs): vendor RapiDoc 9.3.4 (MIT) as static asset

Pinned bundle, checksum in VERSION. Replaces swagger-ui-dist which
shipped a Scarf telemetry pixel.

Refs #7524"
```

---

## Task 10: Admin UI banner when catalog is disabled

**Files:**
- Modify: `admin/src/pages/HomePage.tsx`
- Modify: `admin/src/localization/en.json` (and parallel locale files for keys we already define in English)

- [ ] **Step 1: Add locale string**

In `admin/src/localization/en.json`, add a new key (alphabetically placed near other `admin_plugins.*` keys):

```json
"admin_plugins.catalog_disabled": "Plugin catalog is disabled by your operator (privacy.pluginCatalog=false). To install a plugin, run pnpm run plugins i ep_<name> from the server.",
```

- [ ] **Step 2: Subscribe to results:catalogDisabled and render banner**

In `admin/src/pages/HomePage.tsx`, inside the `useEffect` that wires socket listeners (around line 82-99), add a state hook at the top of the component:

```tsx
const [catalogDisabled, setCatalogDisabled] = useState(false);
```

In the same `useEffect` body, add the listener wiring:

```tsx
const onCatalogDisabled = () => setCatalogDisabled(true);
pluginsSocket.on('results:catalogDisabled', onCatalogDisabled);
```

And in the cleanup:

```tsx
pluginsSocket.off('results:catalogDisabled', onCatalogDisabled);
```

Then in the JSX (around line 137, just inside the `pm-page` div before the header), render:

```tsx
{catalogDisabled && (
  <div className="pm-banner pm-banner-info" role="status">
    <Trans i18nKey="admin_plugins.catalog_disabled"/>
  </div>
)}
```

- [ ] **Step 3: Minimal CSS for the banner**

In `admin/src/index.css`, add (placed near other `.pm-*` rules):

```css
.pm-banner {
  margin: 1rem 0;
  padding: .75rem 1rem;
  border-radius: 6px;
  border: 1px solid var(--ink-3, #cbd5e1);
  background: var(--surface-2, #f8fafc);
  font-size: .9rem;
}
.pm-banner-info { border-left: 4px solid var(--accent, #0ea5e9); }
```

- [ ] **Step 4: Lint and typecheck**

```bash
cd admin && pnpm lint && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Smoke-test the banner**

```bash
# In settings.json (or a local override), set privacy.pluginCatalog: false
# Then:
cd src && pnpm dev
```

Open `/admin/`, log in, navigate to the plugins page. Verify the banner renders and no errors appear in the browser console.

- [ ] **Step 6: Commit**

```bash
git add admin/src/pages/HomePage.tsx admin/src/localization/en.json admin/src/index.css
git commit -m "feat(admin): banner when plugin catalog is disabled

Subscribes to results:catalogDisabled and renders a localized info
banner. install/uninstall still function via CLI.

Refs #7524"
```

---

## Task 11: PRIVACY.md + README + CHANGELOG

**Files:**
- Create: `PRIVACY.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write PRIVACY.md**

Create `PRIVACY.md` at the repo root with this content:

```markdown
# Privacy in Etherpad

## What this document is

A complete, current list of every network call Etherpad's own code makes
to a third party, plus how to turn each one off. Plugins are out of
scope — audit any plugin you install.

## TL;DR

Etherpad ships with two outbound calls to `etherpad.org`. Both are
documented below. Both can be disabled with a single config value each.
No analytics, no usage pings, no third-party SDKs at runtime.

## Outbound calls

### 1. Version check

| | |
|---|---|
| URL       | `https://static.etherpad.org/info.json` (override via `updateServer`) |
| Frequency | hourly while the server runs |
| Payload   | GET only; `User-Agent: Etherpad/<version>` |
| Purpose   | surface an "update available" notice in the admin panel |
| Disable   | set `privacy.updateCheck: false` in `settings.json` |
| Source    | `src/node/utils/UpdateCheck.ts` |

### 2. Plugin catalog

| | |
|---|---|
| URL       | `https://static.etherpad.org/plugins.json` (override via `updateServer`) |
| Frequency | on admin-plugins page load (cached 10 min) |
| Payload   | GET only; same `User-Agent` |
| Purpose   | list installable `ep_*` plugins in the admin UI |
| Disable   | set `privacy.pluginCatalog: false` in `settings.json` (manual install via CLI still works) |
| Source    | `src/static/js/pluginfw/installer.ts` |

## What we removed

`swagger-ui-express` was dropped because the upstream npm package
injects a Scarf analytics pixel that cannot be disabled at install or
runtime (see [swagger-api/swagger-ui#10573](https://github.com/swagger-api/swagger-ui/issues/10573)).
`/api-docs` is now served by a vendored copy of RapiDoc (MIT) with no
outbound calls.

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

- [ ] **Step 2: Add a README pointer**

Open `README.md`. Find the first heading or intro paragraph near the top. Immediately after the existing intro, add one line:

```markdown
**Privacy:** Etherpad makes two opt-out network calls and ships no third-party telemetry. See [PRIVACY.md](PRIVACY.md).
```

- [ ] **Step 3: Add a CHANGELOG entry**

Open `CHANGELOG.md`. Under the unreleased / next-release section, add:

```markdown
- **Privacy:** Dropped `swagger-ui-express` (upstream injects Scarf telemetry); `/api-docs` is now served by vendored RapiDoc. Added `privacy.updateCheck` and `privacy.pluginCatalog` opt-outs for Etherpad's own outbound calls. See [PRIVACY.md](PRIVACY.md). (#7524)
```

- [ ] **Step 4: Commit**

```bash
git add PRIVACY.md README.md CHANGELOG.md
git commit -m "docs: PRIVACY.md and README/CHANGELOG pointers

Publishes Etherpad's stance on telemetry: two documented, opt-out
outbound calls; no third-party analytics; no install-time phone-homes
in our deps.

Refs #7524"
```

---

## Task 12: Final verification

**Files:** none modified.

- [ ] **Step 1: pnpm install clean**

```bash
pnpm install
grep -c "swagger-ui" pnpm-lock.yaml
```

Expected: install succeeds; grep prints `0`.

- [ ] **Step 2: TypeScript across workspaces**

```bash
cd src && pnpm exec tsc --noEmit
cd ../admin && pnpm exec tsc --noEmit
```

Expected: both clean.

- [ ] **Step 3: Backend vitest (per project memory: always run)**

```bash
cd src && pnpm test:vitest
```

Expected: all tests pass, including the three new privacy specs.

- [ ] **Step 4: Source grep**

```bash
grep -rIn "swagger-ui-express\|from 'swagger-ui-express'" src admin bin 2>/dev/null
grep -rIn "swagger" src/node src/static --include="*.ts" 2>/dev/null
```

Expected: first grep returns nothing. Second grep returns only `src/node/hooks/express/openapi.ts:810` (unrelated historical comment) and `src/node/types/SwaggerUIResource.ts` (TypeScript-only type).

- [ ] **Step 5: Manual smoke matrix on port 9003**

Per project memory ("Use port 9003 for snap/local tests, not 9001"), bind tests to 9003. Set `port: 9003` in your settings.json override.

Run dev server, then in a browser:

| Step | Setting | Expected |
|---|---|---|
| a | defaults (both `true`) | `/api-docs` renders RapiDoc, spec loads; no third-party hosts in Network tab |
| b | `privacy.updateCheck: false`, restart | server log shows "Update check disabled..."; no request to `info.json` after 1 hour or on admin settings page load |
| c | `privacy.pluginCatalog: false`, restart | admin plugins page shows the disabled banner; install-by-name via `pnpm run plugins i ep_align` still installs |

Verify each row manually. Per project memory: actually exercise the UI, not just "lint passed".

- [ ] **Step 6: Push and open PR**

```bash
git push -u origin feature/7524-drop-swagger-ui-telemetry
gh pr create --base develop --title "Drop swagger-ui, document telemetry, add opt-outs (#7524)" \
  --body "$(cat <<'EOF'
## Summary
- Drops `swagger-ui-express` (Scarf telemetry pixel, [swagger-api/swagger-ui#10573](https://github.com/swagger-api/swagger-ui/issues/10573))
- `/api-docs` now served by vendored RapiDoc 9.3.4 (MIT)
- New `privacy.updateCheck` and `privacy.pluginCatalog` opt-outs (default `true`, behaviour unchanged)
- New `PRIVACY.md` documenting both outbound calls and how to disable each
- `stalePlugins.ts` CLI now reads `updateServer` and honours the opt-out

Closes #7524.

## Test plan
- [x] `pnpm test:vitest` (3 new specs)
- [x] `pnpm exec tsc --noEmit` clean in `src/` and `admin/`
- [x] Manual: `/api-docs` renders; DevTools Network shows no third-party hosts
- [x] Manual: `privacy.updateCheck: false` prevents info.json fetch
- [x] Manual: `privacy.pluginCatalog: false` renders admin banner; CLI install still works
- [x] Manual: `grep -rIn "swagger-ui-express" src admin bin` returns nothing

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Wait ~20s, then check CI**

```bash
sleep 20
gh pr checks
```

Per project memory: re-check `gh pr checks` at every natural pause; fix red checks before moving on.

- [ ] **Step 8: Action Qodo review comments inline**

Per project memory: "Always action Qodo PR feedback — after opening a PR, fetch Qodo's review comments and fix or reply to each."

```bash
PR=$(gh pr view --json number -q .number)
gh api repos/ether/etherpad/pulls/$PR/comments
```

Resolve every Qodo finding in subsequent commits on this branch.

---

## Self-review checklist (run after writing this plan)

- Spec coverage: deliverable 1 → Tasks 7-9; deliverable 2 → Tasks 1-6; deliverable 3 → Task 11. ✓
- No placeholders: all code blocks contain real code; commands have expected output. ✓
- Type consistency: `privacy.updateCheck`/`privacy.pluginCatalog` used identically everywhere; `results:catalogDisabled` is the one socket event name. ✓
- Test-first: Tasks 1-3 are TDD with failing-test-first steps. Tasks 4-11 are integration/UI surface — verified via manual smoke + typecheck. ✓
- Commit hygiene: each task ends with a commit; one cross-task boundary (Tasks 7+8 share a commit boundary, called out explicitly). ✓
