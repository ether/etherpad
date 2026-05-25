# ESM core / CJS plugin compatibility — design

**Status:** draft, awaiting user review
**Date:** 2026-05-25
**Branch:** `backend-esm-vitest`
**PR:** [ether/etherpad#7605](https://github.com/ether/etherpad/pull/7605)

## Goal

Make PR #7605 ("Backend esm vitest") landable without breaking the existing
plugin ecosystem. PR #7605 converts the etherpad-lite core to ESM and migrates
backend tests from mocha to vitest. CI is failing on three independent causes;
this spec covers all three but most of the design effort is for cause (3).

## Failure causes in PR #7605

1. **Duplicate export in core.** `src/static/js/pad_editor.ts:438` re-exports
   `padeditor` and `focusOnLine` although both are already exported earlier in
   the file (line 300 and 348). esbuild errors with "Multiple exports with the
   same name". Fails the "Linux without plugins" backend matrix.
2. **Conflicts with `develop`.** `develop` is ~33 commits ahead of the
   branch's last merge (`7d5268b`). Notable: `689dd9d43 chore: fixed backend
   tests` likely touches files the vitest migration rewrote. Several dep
   bumps and feat/fix commits also need merging.
3. **CJS plugins cannot resolve subpaths of `ep_etherpad-lite`.** Sample
   plugins fail with patterns like
   `Cannot find module 'ep_etherpad-lite/node/eejs/'`,
   `Cannot find module 'ep_etherpad-lite/node/db/AuthorManager'`, and
   `Cannot find module './exportMarkdown'`. Root cause: `src/package.json`
   has `"type": "module"` and no `exports` map, so Node refuses to resolve
   extensionless and directory subpaths under ESM rules.

(1) and (2) are mechanical fixes; the design below addresses (3).

## Plugin import surface

`src/package.json` is published as the `ep_etherpad-lite` package — the plugin
loader's `getPackages()` (`src/static/js/pluginfw/plugins.ts:224-229`) links
`node_modules/ep_etherpad-lite` to `src/`. Today its `package.json` has only
`"type": "module"` and `"name": "ep_etherpad-lite"` — no `main`, no `exports`.

Sampled CJS plugin imports against `ep_etherpad-lite`:

```
require('ep_etherpad-lite/node/eejs')
require('ep_etherpad-lite/node/eejs/')
require('ep_etherpad-lite/node/db/PadManager')
require('ep_etherpad-lite/node/db/API.js')
require('ep_etherpad-lite/node/db/AuthorManager')
require('ep_etherpad-lite/static/js/pad_utils')
require('ep_etherpad-lite/tests/backend/common')
```

Plus relative `require('./helper')` inside the plugin. Plugin source files
are typically TypeScript with CJS-style `require()`; they previously worked
because `tsx`/ts-node resolved `.ts` extensionlessly under CJS semantics. ESM
strict resolution removes both affordances.

`eejs.require('./templates/foo.html', {}, module)` is etherpad's own template
loader API — independent of Node module resolution, kept as-is.

## Design

### Decision: dual-emit `ep_etherpad-lite`

Ship the existing TypeScript sources unchanged. Add a build that emits

- `src/dist/...js`     — ESM JavaScript twins, one per `.ts` source
- `src/dist-cjs/...cjs` — CJS twins that re-export the ESM module

Add an `exports` map to `src/package.json` that routes each subpath plugins
consume to the right twin based on the `import` vs `require` condition.

Plugins keep their `require()` calls unchanged. Authors who want to ship ESM
plugins follow the documented `import` track (extensions-required).

### `src/package.json` exports map

```json
{
  "name": "ep_etherpad-lite",
  "type": "module",
  "main": "./dist-cjs/node/server.cjs",
  "module": "./dist/node/server.js",
  "exports": {
    ".": {
      "import": "./dist/node/server.js",
      "require": "./dist-cjs/node/server.cjs"
    },
    "./node/*": {
      "import": "./dist/node/*.js",
      "require": "./dist-cjs/node/*.cjs"
    },
    "./node/eejs": {
      "import": "./dist/node/eejs/index.js",
      "require": "./dist-cjs/node/eejs/index.cjs"
    },
    "./static/js/*": {
      "import": "./dist/static/js/*.js",
      "require": "./dist-cjs/static/js/*.cjs"
    },
    "./tests/backend/*": {
      "import": "./dist/tests/backend/*.js",
      "require": "./dist-cjs/tests/backend/*.cjs"
    },
    "./package.json": "./package.json"
  }
}
```

The wildcard `./node/*` covers extensionless subpaths like `node/db/PadManager`
and `node/utils/Settings`. The explicit `./node/eejs` entry handles the
historical "directory require" form (with or without trailing slash) by routing
to `eejs/index`. Existing plugins that wrote `require('ep_etherpad-lite/node/db/API.js')`
(with explicit `.js`) keep working because the wildcard target `./node/*.cjs`
is matched against the requested path `node/db/API.js` → with the `.cjs`
extension swap the resolver finds `dist-cjs/node/db/API.js.cjs`. To support
that form without doubling the map, a second wildcard pair is added:

```json
    "./node/*.js": {
      "import": "./dist/node/*.js",
      "require": "./dist-cjs/node/*.cjs"
    }
```

(and equivalent for `./static/js/*.js`, `./tests/backend/*.js`). Trailing-`.js`
imports survive because Node treats the `.js` as part of the wildcard match
pattern, not as a literal extension to append.

### Build tool: tsdown

Build with [tsdown](https://tsdown.dev/) (rolldown-based). One config emits
both ESM and CJS without bundling, preserving the directory structure:

```ts
// src/tsdown.config.ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'node/**/*.ts',
    'static/js/**/*.ts',
    'tests/backend/**/*.ts',
  ],
  format: ['esm', 'cjs'],
  outDir: '.',
  outExtensions: ({ format }) =>
    format === 'cjs'
      ? { js: '.cjs', dir: 'dist-cjs' }
      : { js: '.js', dir: 'dist' },
  bundle: false,
  dts: false,
  clean: ['dist', 'dist-cjs'],
  target: 'node24',
});
```

(Field names per tsdown's tsup-compat shape; verify against
<https://tsdown.dev/guide/migrate-from-tsup> at implementation time.)

**Smoke check at implementation start**: run tsdown on one `.ts` file, confirm
it emits a `.cjs` file whose content is a CJS re-export (not an ESM module).
If tsdown's `bundle: false` doesn't behave per-file the way tsup does, fall
back to tsup.

Build runs:
- Before `pnpm test` (via prescript or vitest `globalSetup`)
- In CI before the backend-tests job
- On `pnpm run dev` via tsdown's watch mode

`dist/` and `dist-cjs/` are gitignored. The pnpm-store cache key includes a
hash of `src/**/*.ts` + the tsdown config so re-runs are fast.

### Plugin loader updates

`src/static/js/pluginfw/plugins.ts` — three changes, all in `loadServerHook`:

1. Extend the extension probe list from `[.ts, .js, bare]` to
   `[.ts, .js, .cjs, .mjs, bare]`. Fixes plugins that ship `.cjs` entries
   (e.g. ep_readonly_guest).
2. (Already present — keep.) Look up the hook function on both `mod` and
   `mod.default`. Modern Node `import()` of a CJS file exposes the
   `module.exports` value on `.default`, so existing code path covers it.
3. (Already present — keep.) Use `pathToFileURL(...).href` for the import
   specifier. Required because hook target paths are absolute filesystem
   paths.

What we explicitly **do not** add:

- No `createRequire` fallback in the loader. The exports map plus `.cjs`
  shims fix resolution at the published-package layer, not at the consumer.
- No CJS-vs-ESM detection branch in the loader. `import()` handles both.
- No changes to `LinkInstaller`, `live-plugin-manager`, or `getPackages()`.

### Internal API: `eejs.require` is unchanged

Plugins call `eejs.require('./templates/foo.html', {}, module)` from inside
their CJS code. The third argument is the plugin's CJS `module` object so
`eejs` can resolve the template relative to the caller. This API is
independent of Node module resolution and keeps working as-is.

For ESM plugins (opt-in track, below) we add a sibling API:
`eejs.render('./templates/foo.html', locals, import.meta.url)` that takes a
URL string instead of a `module` object. The implementations share their core
template logic.

## Testing

### Layer 1: fixture plugins

Three small plugins under `src/tests/backend/fixtures/plugins/`:

| Plugin | Import style | What it covers |
| --- | --- | --- |
| `ep_compat_cjs_require` | `require('ep_etherpad-lite/...')` + relative `require('./helper')` | The default plugin shape today |
| `ep_compat_esm_import` | `import ... from 'ep_etherpad-lite/.../*.js'` | The documented ESM-track path |
| `ep_compat_mixed` | `.ts` source with `require()` calls | The "ep_markdown" shape — TS authored, CJS-resolved |

A vitest spec loads each via the real plugin loader, calls one hook on each,
asserts the return value. Failures are surfaced per-plugin so it's clear
which import style regressed.

### Layer 2: the existing "with plugins" CI matrix

Already exists. Currently failing — passing it is the integration-level
acceptance signal.

### Layer 3: `pnpm run check:exports`

A small script that:
1. Reads `src/package.json`'s `exports` map.
2. For each pattern, expands the wildcard against the actual `src/dist/` and
   `src/dist-cjs/` trees.
3. Asserts every target resolves to an existing file.

Runs in CI after the build step. Catches "new source file added, build not
rerun" footguns.

### What we don't test

- No mocked module resolver. The exports map is exercised end-to-end.
- No exhaustive plugin matrix. Layer 2 covers ecosystem reality.

## Prework (CI green before the compat work)

Fold into the implementation plan; not architectural decisions:

1. **Fix duplicate export.** Delete `src/static/js/pad_editor.ts:438`.
   Confirm `padeditor` (line 300) and `focusOnLine` (line 348) are the
   surviving exports.
2. **Merge `develop` into `backend-esm-vitest`.** Resolve the
   `689dd9d43` backend-test conflicts by taking the branch's vitest-shaped
   version and reapplying any logic deltas from develop. Take develop's
   side on dep bumps. Re-run prework step 1 after merging in case any of
   develop's new files introduce another export collision.

## ESM-plugin migration track

Opt-in for plugin authors. No deadline. Documented in `doc/api/plugins.adoc`
and demonstrated by a template plugin under `bin/plugins/template-esm/`.

A plugin opts in by:

1. Setting `"type": "module"` in its own `package.json`.
2. Writing hook targets in `ep.json` with explicit `.js` extensions.
3. Importing etherpad subpaths with extensions:
   ```js
   import { eejs } from 'ep_etherpad-lite/node/eejs/index.js';
   import { getPad } from 'ep_etherpad-lite/node/db/PadManager.js';
   ```
4. Using `eejs.render(url, locals, import.meta.url)` instead of
   `eejs.require(path, locals, module)` for templates.

CJS plugins are not deprecated. The `require` condition stays indefinitely.

## Non-goals

- Migrating any community plugin to ESM. That's plugin authors' call.
- Removing `eejs.require`. It stays for CJS plugins.
- Bundling the runtime. Plugins still consume files; `bundle: false`.
- A `peerDependencies`-style enforced version pin. Plugin compat with a
  specific etherpad major is the plugin author's responsibility.

## Open implementation questions

These don't change the design but need a decision during implementation:

- **Does vitest's resolver honor the exports map in dev?** Expected yes —
  vitest delegates to Node-like resolution by default. Verify on first test
  run; if not, add `vitest.config.ts` `resolve.conditions: ['node', 'import']`.
- **Does `live-plugin-manager` honor exports for transitive plugin
  requires?** It runs CJS resolution under the hood; the `require` condition
  should match. Verify with one installed plugin.
- **Source map paths.** `dist-cjs/node/foo.cjs` should point its source map
  back to `node/foo.ts`. tsdown handles this by default; spot-check after
  first build.
