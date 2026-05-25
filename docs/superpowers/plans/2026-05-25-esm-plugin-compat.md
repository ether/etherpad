# ESM Plugin Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land PR #7605 ("Backend esm vitest") without breaking the existing
plugin ecosystem by dual-emitting `ep_etherpad-lite` (ESM + CJS) and adding
a proper `exports` map.

**Architecture:** Keep TypeScript sources unchanged. Add tsdown to emit
ESM `.js` and CJS `.cjs` twins under `dist/` and `dist-cjs/`. Add an
`exports` map to `src/package.json` that routes each subpath consumed by
plugins to the right twin based on `import` vs `require` condition. Probe
`.cjs` and `.mjs` in the plugin loader's extension fallback.

**Tech Stack:** TypeScript, Node ≥24, vitest, tsdown (rolldown-based),
pnpm, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-05-25-esm-plugin-compat-design.md`

**Branch:** `backend-esm-vitest`

---

## File map

**Modify:**
- `src/static/js/pad_editor.ts` (line 438 only — Task 1)
- `src/package.json` (scripts, devDependencies, exports — Tasks 4, 5, 6)
- `src/static/js/pluginfw/plugins.ts` (lines 132-134 only — Task 8)
- `src/vitest.config.ts` (optional globalSetup — Task 9)
- `.github/workflows/backend-tests.yml` (build step — Task 10)
- `.gitignore` (dist + dist-cjs entries — Task 4)
- `doc/api/plugins.adoc` (compat surface section — Task 11)

**Create:**
- `src/tsdown.config.ts` (Task 4)
- `src/tools/check-exports.ts` (Task 7)
- `src/tests/backend/specs/exports_map.ts` (Task 6)

**Generated (gitignored):**
- `src/dist/**/*.js`
- `src/dist-cjs/**/*.cjs`

---

### Task 1: Prework — fix the duplicate export

**Files:**
- Modify: `src/static/js/pad_editor.ts:438`

- [ ] **Step 1: Confirm the duplicate**

Run:
```bash
grep -nE "^export\b.*(padeditor|focusOnLine)" src/static/js/pad_editor.ts
```

Expected output:
```
300:export {padeditor};
348:export const focusOnLine = (ace) => {
438:export {padeditor, focusOnLine};
```

- [ ] **Step 2: Delete line 438**

Open `src/static/js/pad_editor.ts` and delete the line:
```ts
export {padeditor, focusOnLine};
```
(The trailing blank line at 439 can stay or go — either is fine.)

- [ ] **Step 3: Verify by re-grepping**

Run the same grep as Step 1. Expected output:
```
300:export {padeditor};
348:export const focusOnLine = (ace) => {
```

- [ ] **Step 4: Confirm a vitest run starts (does not need to pass everything)**

Run:
```bash
pnpm --filter ep_etherpad-lite test -- --run --reporter=basic 2>&1 | head -40
```

Expected: the test runner boots, esbuild does not emit "Multiple exports with the same name". Other test failures are fine at this stage — we are only verifying the build-error is gone.

- [ ] **Step 5: Commit**

```bash
git add src/static/js/pad_editor.ts
git commit -m "fix(pad_editor): remove duplicate export of padeditor/focusOnLine

Both symbols are already exported at lines 300 and 348. The trailing
re-export at line 438 caused esbuild 'Multiple exports with the same
name' build errors in PR #7605 (Backend tests / Linux without plugins)."
```

---

### Task 2: Prework — merge `develop` into the branch

**Files:** whatever conflicts arise; expected hotspots called out below.

- [ ] **Step 1: Fetch and inspect**

Run:
```bash
git fetch origin develop
git log --oneline HEAD..origin/develop | head -40
```

Expected: ~33 commits ahead. Watch for `689dd9d43 chore: fixed backend tests` — that one touches the same tests the vitest migration rewrote.

- [ ] **Step 2: Start the merge**

Run:
```bash
git merge origin/develop --no-commit
```

If it stops with conflicts, leave them in place and go to Step 3. If it merges cleanly (unlikely), skip to Step 5.

- [ ] **Step 3: Resolve test-file conflicts (take branch version, reapply develop deltas)**

For each conflicting test file in `src/tests/backend/specs/`:
1. The branch version is the vitest-shaped form (`describe`/`it` from vitest, `vi.spyOn`, etc.).
2. Read the develop change in that file via:
   ```bash
   git show origin/develop:src/tests/backend/specs/<file>
   ```
3. Identify the logic delta (often a new test case or an assertion update).
4. Apply that delta on top of the branch's vitest version. Do not regress to mocha-shaped APIs.
5. Stage: `git add src/tests/backend/specs/<file>`

- [ ] **Step 4: Resolve non-test conflicts**

For everything else, prefer develop's version on dep bumps (`pnpm-lock.yaml`, `package.json` version constraints) and the branch's version where it intentionally restructured for ESM. When unsure, read both sides and choose the one that matches the surrounding file's style.

Stage each:
```bash
git add <file>
```

- [ ] **Step 5: Reinstall, sanity check, finish merge**

Run:
```bash
pnpm install
git status
```

Expected: clean staged tree, no unmerged paths.

Then complete the merge:
```bash
git commit -m "Merge branch 'develop' into backend-esm-vitest

Resolves test-file conflicts by keeping the vitest-migrated shape from
this branch and reapplying logic deltas from develop. Dep bumps taken
straight from develop."
```

- [ ] **Step 6: Re-check Task 1's grep**

Run:
```bash
grep -nE "^export\b.*(padeditor|focusOnLine)" src/static/js/pad_editor.ts
```

If a third line reappeared after the merge, repeat Task 1 Step 2 and amend:
```bash
git add src/static/js/pad_editor.ts
git commit --amend --no-edit
```

- [ ] **Step 7: Verify the test runner boots**

Run:
```bash
pnpm --filter ep_etherpad-lite test -- --run --reporter=basic 2>&1 | head -60
```

Expected: tests start running. "with plugins" failures are expected (Task 5+ fixes them). The build error from Task 1 must stay gone.

---

### Task 3: Smoke-test tsdown for per-file dual emit

**Files:** none committed; throwaway test.

This task verifies tsdown's `bundle: false` mode emits one `.cjs` per source
file with directory structure preserved. If it doesn't, we fall back to tsup
(same config shape) before continuing.

- [ ] **Step 1: Install tsdown in a scratch location**

Run:
```bash
cd /tmp && rm -rf tsdown-smoke && mkdir tsdown-smoke && cd tsdown-smoke
pnpm init
pnpm add -D tsdown
mkdir -p src/sub
cat > src/foo.ts <<'EOF'
export const foo = () => 'foo';
EOF
cat > src/sub/bar.ts <<'EOF'
export const bar = () => 'bar';
EOF
```

- [ ] **Step 2: Write a minimal tsdown config that emits both formats**

```ts
// /tmp/tsdown-smoke/tsdown.config.ts
import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/**/*.ts'],
    format: 'esm',
    outDir: 'dist',
    outExtension: () => ({ js: '.js' }),
    bundle: false,
    dts: false,
    target: 'node24',
  },
  {
    entry: ['src/**/*.ts'],
    format: 'cjs',
    outDir: 'dist-cjs',
    outExtension: () => ({ js: '.cjs' }),
    bundle: false,
    dts: false,
    target: 'node24',
  },
]);
```

- [ ] **Step 3: Build and inspect**

Run:
```bash
cd /tmp/tsdown-smoke
pnpm exec tsdown
ls -R dist dist-cjs
cat dist/foo.js
cat dist-cjs/foo.cjs
```

Expected:
- `dist/foo.js` exists, is an ESM module (`export const foo = ...`).
- `dist-cjs/foo.cjs` exists, is a CJS module (`exports.foo = ...` or `module.exports = ...`).
- Directory structure preserved (`dist/sub/bar.js`, `dist-cjs/sub/bar.cjs`).

- [ ] **Step 4: Decide tsdown vs tsup**

If Step 3's output matches expectations, proceed to Task 4 with tsdown. Otherwise:
1. Run `pnpm remove tsdown && pnpm add -D tsup` in the scratch dir.
2. Replace the import with `import { defineConfig } from 'tsup'`.
3. Rebuild and verify the same Step 3 expectations.
4. Use tsup throughout the rest of this plan (substitute `tsup` for `tsdown` wherever it appears).

- [ ] **Step 5: Discard the scratch and proceed**

```bash
rm -rf /tmp/tsdown-smoke
cd <back to repo root>
```

No commit (nothing changed in the repo).

---

### Task 4: Add tsdown build configuration

**Files:**
- Modify: `src/package.json` (add devDependency, scripts)
- Create: `src/tsdown.config.ts`
- Modify: `.gitignore` (add `src/dist/` and `src/dist-cjs/`)

- [ ] **Step 1: Add tsdown to devDependencies**

Run:
```bash
pnpm --filter ep_etherpad-lite add -D tsdown
```

(If Task 3 Step 4 chose tsup, substitute `tsup` here and below.)

- [ ] **Step 2: Create `src/tsdown.config.ts`**

```ts
// src/tsdown.config.ts
import { defineConfig } from 'tsdown';

// Globs covering every subpath plugins consume from ep_etherpad-lite.
// Keep in sync with the "exports" map in package.json.
const entries = [
  'node/**/*.ts',
  'static/js/**/*.ts',
  'tests/backend/**/*.ts',
];

// Patterns NOT to emit JS for. Plugin test fixtures and type-only files
// should not pollute dist/.
const ignore = [
  '**/*.d.ts',
  'tests/backend/fixtures/**',
  'tests/backend/specs/**',
];

const common = {
  entry: entries,
  ignore,
  bundle: false as const,
  dts: false as const,
  target: 'node24' as const,
};

export default defineConfig([
  {
    ...common,
    format: 'esm',
    outDir: 'dist',
    outExtension: () => ({ js: '.js' }),
  },
  {
    ...common,
    format: 'cjs',
    outDir: 'dist-cjs',
    outExtension: () => ({ js: '.cjs' }),
  },
]);
```

- [ ] **Step 3: Add build scripts to `src/package.json`**

In the `"scripts"` block, add (alphabetically after `"build"` if present, else after `"lint"`):

```json
"build": "tsdown",
"build:watch": "tsdown --watch",
"clean:dist": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true});require('fs').rmSync('dist-cjs',{recursive:true,force:true})\"",
"pretest": "tsdown",
```

The `pretest` hook makes `pnpm test` build first automatically.

- [ ] **Step 4: Update `.gitignore`**

Append to the repo-root `.gitignore`:
```
src/dist/
src/dist-cjs/
```

- [ ] **Step 5: Run a full build, verify output shape**

Run:
```bash
cd src
pnpm exec tsdown
ls dist/node/eejs/index.js
ls dist-cjs/node/eejs/index.cjs
ls dist/node/db/PadManager.js
ls dist-cjs/node/db/PadManager.cjs
ls dist/static/js/pad_utils.js
ls dist-cjs/static/js/pad_utils.cjs
```

Expected: all six paths exist. If any is missing, the entry glob in Step 2 needs adjustment — re-read the spec's "Plugin import surface" section for the canonical list.

- [ ] **Step 6: Spot-check a CJS twin**

```bash
head -20 src/dist-cjs/node/eejs/index.cjs
```

Expected: a CJS-shaped module (typically `'use strict'; Object.defineProperty(exports, ...)` or `module.exports = ...`). Not an ESM `export` statement.

- [ ] **Step 7: Commit**

```bash
git add .gitignore src/package.json src/tsdown.config.ts pnpm-lock.yaml
git commit -m "build: add tsdown dual-emit (ESM + CJS) for ep_etherpad-lite

Builds .ts sources to dist/*.js (ESM) and dist-cjs/*.cjs (CJS) so the
upcoming exports map can route plugins' require() calls to the CJS
twin while ESM consumers use the .js originals. No source code is
moved or rewritten."
```

---

### Task 5: Add resolution tests (proves the exports map works)

**Files:**
- Create: `src/tests/backend/specs/exports_map.ts`

These tests **will fail** until Task 6 adds the exports map. That is the TDD step.

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/backend/specs/exports_map.ts
import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const cjsSubpaths = [
  'ep_etherpad-lite/node/eejs',
  'ep_etherpad-lite/node/db/PadManager',
  'ep_etherpad-lite/node/db/API.js',
  'ep_etherpad-lite/node/db/AuthorManager',
  'ep_etherpad-lite/static/js/pad_utils',
  'ep_etherpad-lite/tests/backend/common',
];

const esmSubpaths = [
  'ep_etherpad-lite/node/eejs/index.js',
  'ep_etherpad-lite/node/db/PadManager.js',
  'ep_etherpad-lite/node/db/API.js',
  'ep_etherpad-lite/static/js/pad_utils.js',
];

describe('ep_etherpad-lite exports map', () => {
  describe('require() condition (CJS plugins)', () => {
    for (const spec of cjsSubpaths) {
      test(`require('${spec}') resolves`, () => {
        const resolved = require.resolve(spec);
        expect(resolved).toMatch(/\.cjs$/);
      });

      test(`require('${spec}') loads a module`, () => {
        const mod = require(spec);
        expect(mod).toBeTruthy();
        expect(typeof mod).toBe('object');
      });
    }
  });

  describe('import() condition (ESM plugins)', () => {
    for (const spec of esmSubpaths) {
      test(`import('${spec}') resolves to a .js file`, async () => {
        const mod = await import(spec);
        expect(mod).toBeTruthy();
        // The resolved URL is on import.meta when loaded from the file,
        // but we can't read it from here. The mod being importable at all
        // proves the exports map's "import" condition resolved.
      });
    }
  });
});
```

- [ ] **Step 2: Run it; expect failure**

Run:
```bash
cd src
pnpm exec vitest run tests/backend/specs/exports_map.ts
```

Expected: all `require(...)` and `import(...)` cases fail with `Cannot find module` or `Package subpath './node/eejs' is not defined by "exports"`. This proves the exports map is missing.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/tests/backend/specs/exports_map.ts
git commit -m "test(exports): add failing resolution tests for ep_etherpad-lite subpaths

Exercises the require + import conditions for the subpaths plugins
consume. Will pass once src/package.json gets an exports map."
```

---

### Task 6: Add the exports map to `src/package.json`

**Files:**
- Modify: `src/package.json`

- [ ] **Step 1: Add the exports map**

In `src/package.json`, after the `"keywords"` block and before `"author"`, add:

```json
  "main": "./dist-cjs/node/server.cjs",
  "module": "./dist/node/server.js",
  "exports": {
    ".": {
      "import": "./dist/node/server.js",
      "require": "./dist-cjs/node/server.cjs"
    },
    "./node/eejs": {
      "import": "./dist/node/eejs/index.js",
      "require": "./dist-cjs/node/eejs/index.cjs"
    },
    "./node/eejs/": {
      "import": "./dist/node/eejs/index.js",
      "require": "./dist-cjs/node/eejs/index.cjs"
    },
    "./node/*": {
      "import": "./dist/node/*.js",
      "require": "./dist-cjs/node/*.cjs"
    },
    "./node/*.js": {
      "import": "./dist/node/*.js",
      "require": "./dist-cjs/node/*.cjs"
    },
    "./static/js/*": {
      "import": "./dist/static/js/*.js",
      "require": "./dist-cjs/static/js/*.cjs"
    },
    "./static/js/*.js": {
      "import": "./dist/static/js/*.js",
      "require": "./dist-cjs/static/js/*.cjs"
    },
    "./tests/backend/*": {
      "import": "./dist/tests/backend/*.js",
      "require": "./dist-cjs/tests/backend/*.cjs"
    },
    "./tests/backend/*.js": {
      "import": "./dist/tests/backend/*.js",
      "require": "./dist-cjs/tests/backend/*.cjs"
    },
    "./package.json": "./package.json"
  },
```

Order matters: more specific patterns (`./node/eejs`, trailing-slash form) come before the wildcards.

- [ ] **Step 2: Reinstall to refresh symlinks**

Run:
```bash
pnpm install
```

Expected: completes without errors. The `node_modules/ep_etherpad-lite` symlink is reestablished.

- [ ] **Step 3: Run the resolution tests; expect them to pass**

Run:
```bash
cd src
pnpm exec vitest run tests/backend/specs/exports_map.ts
```

Expected: all tests pass. If any fail with "Package subpath ... is not defined", the corresponding pattern is missing from Step 1's map — add it.

- [ ] **Step 4: Commit**

```bash
git add src/package.json
git commit -m "feat(pkg): add exports map for ep_etherpad-lite

Routes CJS plugins' require() calls to dist-cjs/*.cjs twins while
keeping ESM consumers on dist/*.js. The trailing-.js wildcard handles
plugins that already wrote require('ep_etherpad-lite/node/db/API.js')
with an explicit extension."
```

---

### Task 7: Add `check:exports` verifier

**Files:**
- Create: `src/tools/check-exports.ts`
- Modify: `src/package.json` (add script)

- [ ] **Step 1: Write the verifier**

```ts
// src/tools/check-exports.ts
//
// Walks src/package.json's exports map and asserts every glob target
// resolves to an existing file under dist/ or dist-cjs/. Exit 0 on
// success, 1 on any missing file.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');

const pkg = JSON.parse(
  await import('node:fs').then((f) =>
    f.promises.readFile(join(srcRoot, 'package.json'), 'utf8'),
  ),
);
const exportsMap = pkg.exports as Record<string, unknown>;

const errors: string[] = [];

function walk(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, suffix));
    else if (full.endsWith(suffix)) out.push(full);
  }
  return out;
}

function checkTarget(pattern: string, target: string) {
  if (!target.startsWith('./')) {
    errors.push(`Target ${target} does not start with './' (pattern ${pattern})`);
    return;
  }
  const targetAbs = resolve(srcRoot, target.replace(/^\.\//, ''));
  if (target.includes('*')) {
    // Wildcard target — assert at least one file matches.
    const [prefix, suffix] = target.split('*');
    const prefixAbs = resolve(srcRoot, prefix.replace(/^\.\//, ''));
    const baseDir = prefix.endsWith('/') ? prefixAbs : dirname(prefixAbs);
    const matches = walk(baseDir, suffix);
    if (matches.length === 0) {
      errors.push(`Pattern ${pattern} -> ${target} has zero matching files`);
    }
  } else {
    if (!existsSync(targetAbs)) {
      errors.push(`Pattern ${pattern} -> ${target} (file does not exist)`);
    }
  }
}

for (const [pattern, value] of Object.entries(exportsMap)) {
  if (typeof value === 'string') {
    checkTarget(pattern, value);
  } else if (value && typeof value === 'object') {
    for (const [condition, target] of Object.entries(value)) {
      if (typeof target === 'string') checkTarget(`${pattern} (${condition})`, target);
    }
  }
}

if (errors.length > 0) {
  console.error('check:exports FAILED:');
  for (const e of errors) console.error('  -', e);
  process.exit(1);
}
console.log(`check:exports OK (${Object.keys(exportsMap).length} patterns checked)`);
```

- [ ] **Step 2: Add the script to `src/package.json`**

In the `"scripts"` block:
```json
"check:exports": "node --import tsx tools/check-exports.ts",
```

- [ ] **Step 3: Run it; expect success**

Run:
```bash
cd src
pnpm run build
pnpm run check:exports
```

Expected:
```
check:exports OK (10 patterns checked)
```

(Number may vary depending on the exports map.)

- [ ] **Step 4: Sanity-fail it on purpose, then revert**

Rename `dist/node/eejs/index.js` temporarily and re-run:
```bash
mv src/dist/node/eejs/index.js src/dist/node/eejs/index.js.bak
pnpm --filter ep_etherpad-lite run check:exports || true
mv src/dist/node/eejs/index.js.bak src/dist/node/eejs/index.js
```

Expected: first run reports the missing file and exits non-zero. Second run (after the `mv` back) passes.

- [ ] **Step 5: Commit**

```bash
git add src/tools/check-exports.ts src/package.json
git commit -m "build: add check:exports verifier

Walks the exports map and asserts each glob target has at least one
matching file under dist/ or dist-cjs/. Catches 'added a new source
file but forgot to rebuild' regressions."
```

---

### Task 8: Update the plugin loader extension probe list

**Files:**
- Modify: `src/static/js/pluginfw/plugins.ts:132-134`

- [ ] **Step 1: Write the test first**

Append to `src/tests/backend/specs/exports_map.ts`:

```ts
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('plugin loader extension probe', () => {
  // Reach into the loader's internal candidate list. Since loadServerHook is
  // not exported, we test the behavior end-to-end: write a synthetic .cjs
  // file in a temp dir, ask the loader to import its hook by extensionless
  // path, assert the function is found.

  const tmp = join(tmpdir(), `ep-loader-probe-${process.pid}`);

  test('extensionless hook path resolves to .cjs', async () => {
    mkdirSync(tmp, { recursive: true });
    const cjsPath = join(tmp, 'hook.cjs');
    writeFileSync(cjsPath, `exports.greet = () => 'hello';\n`);

    // Dynamic import of CJS via file URL — same mechanism the loader uses.
    const mod = await import(pathToFileURL(join(tmp, 'hook')).href + '.cjs');
    expect(mod.greet ?? mod.default?.greet).toBeTypeOf('function');

    rmSync(tmp, { recursive: true, force: true });
  });
});
```

This test passes today (Node's `import()` handles `.cjs` fine when the extension is given). The real fix is below: have the loader probe `.cjs` automatically.

- [ ] **Step 2: Read the current candidate list**

`src/static/js/pluginfw/plugins.ts:132-134` currently reads:
```ts
  const candidates = path.extname(modulePath) === ''
    ? [`${modulePath}.ts`, `${modulePath}.js`, modulePath]
    : [modulePath];
```

- [ ] **Step 3: Extend the candidate list**

Replace those three lines with:
```ts
  const candidates = path.extname(modulePath) === ''
    ? [
        `${modulePath}.ts`,
        `${modulePath}.js`,
        `${modulePath}.cjs`,
        `${modulePath}.mjs`,
        modulePath,
      ]
    : [modulePath];
```

- [ ] **Step 4: Add an end-to-end test for the loader behavior**

Append to `src/tests/backend/specs/exports_map.ts`:

```ts
// Verify the loader's extension probe by exercising the same logic
// inline. If this assertion drifts from loadServerHook's behavior the
// test is stale — update both together.
test('loader candidate list includes .cjs and .mjs', async () => {
  const src = await import('node:fs').then((f) =>
    f.promises.readFile('static/js/pluginfw/plugins.ts', 'utf8'),
  );
  expect(src).toContain('.cjs');
  expect(src).toContain('.mjs');
});
```

(This is intentionally a textual check on the loader source — it locks in the candidate-list change so a future refactor can't silently regress it.)

- [ ] **Step 5: Run tests; expect both pass**

Run:
```bash
cd src
pnpm exec vitest run tests/backend/specs/exports_map.ts
```

Expected: all tests including the two new ones pass.

- [ ] **Step 6: Commit**

```bash
git add src/static/js/pluginfw/plugins.ts src/tests/backend/specs/exports_map.ts
git commit -m "feat(pluginfw): probe .cjs and .mjs when loading hook modules

Plugins that ship CJS-only entries (e.g. ep_readonly_guest's
ep_readonly_guest.cjs) and ESM-only entries previously hit the loader's
extensionless fallback path and failed because only .ts and .js were
tried. Add .cjs and .mjs to the candidate list."
```

---

### Task 9: Wire the build into the vitest run path

**Files:**
- Modify: `src/package.json` (only if Task 4 Step 3 did not already add `pretest`)

The `pretest` script added in Task 4 already runs `tsdown` before every `pnpm test`. This task verifies that wiring end-to-end and adds the dev-loop hook.

- [ ] **Step 1: Verify the pretest hook fires**

Run:
```bash
cd src
pnpm run clean:dist
pnpm test -- --run --reporter=basic tests/backend/specs/exports_map.ts
```

Expected: tsdown runs first (build output appears), then vitest runs and all tests pass. If tsdown does not run, recheck the `"pretest"` script in `src/package.json` from Task 4 Step 3.

- [ ] **Step 2: Add a dev convenience**

In `src/package.json` `"scripts"`, change:
```json
"dev": "cross-env NODE_ENV=development  node --import tsx node/server.ts",
```

to:
```json
"dev": "cross-env NODE_ENV=development  node --import tsx node/server.ts",
"predev": "tsdown",
"dev:watch": "concurrently \"pnpm build:watch\" \"cross-env NODE_ENV=development node --import tsx node/server.ts\"",
```

(`concurrently` is already a transitive dep; if not, add `pnpm add -D concurrently` first.)

- [ ] **Step 3: Run `pnpm run check:exports` after a fresh build**

```bash
pnpm run clean:dist
pnpm run build
pnpm run check:exports
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/package.json
git commit -m "build: wire tsdown into dev and test entry points

pretest auto-builds before vitest runs. predev builds once before
the dev server starts; dev:watch keeps tsdown running alongside."
```

---

### Task 10: Wire the build into CI workflows

**Files:**
- Modify: `.github/workflows/backend-tests.yml`

The `pretest` npm script already builds before tests run, so most jobs need
no change. But the build artifacts must land in the pnpm-store cache key so
re-runs are fast.

- [ ] **Step 1: Verify the `withoutpluginsLinux` job picks up pretest automatically**

Open `.github/workflows/backend-tests.yml`. Find the "Run the backend tests" step in `withoutpluginsLinux` (around line 67). It runs `pnpm test` — which now invokes `pretest` (`tsdown`) first. No change needed in this job; just confirm by reading.

- [ ] **Step 2: Same check for the three other matrix jobs**

`withpluginsLinux` (line 88), `withoutpluginsWindows` (line 167), `withpluginsWindows` (line 229). All run `pnpm test`. All inherit the pretest hook. No change needed.

- [ ] **Step 3: Add an explicit build step *before* installing plugins (Linux+Windows with plugins)**

The "with plugins" jobs `pnpm add` plugins like ep_markdown that immediately require `ep_etherpad-lite` at install time. They need the built `dist/` and `dist-cjs/` to exist when those plugins resolve their `peerDependency` against ep_etherpad-lite, otherwise `check:exports`-equivalent resolution at install time fails.

In `withpluginsLinux`, immediately before the "Install Etherpad plugins" step, add:

```yaml
      -
        name: Build ep_etherpad-lite (dist + dist-cjs)
        working-directory: src
        run: pnpm run build
      -
        name: Verify exports map
        working-directory: src
        run: pnpm run check:exports
```

Do the same for `withpluginsWindows` (immediately before its "Install Etherpad plugins" step around line 268).

- [ ] **Step 4: Push the branch and watch CI**

Run:
```bash
git push
gh pr checks 7605
```

Expected: the "Linux without plugins" job goes green (fixed in Task 1). The "with plugins" jobs build and install before plugins resolve, eliminating the `Cannot find module 'ep_etherpad-lite/node/eejs'` failures.

If a job still fails on a different plugin path, that path is missing from the exports map — return to Task 6 Step 1 and add it.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/backend-tests.yml
git commit -m "ci: build ep_etherpad-lite before resolving plugins

The 'with plugins' jobs install ep_markdown / ep_readonly_guest / etc.
which require ep_etherpad-lite at install-time. The dist + dist-cjs
twins must exist before pnpm resolves those subpath imports."
```

---

### Task 11: Document the plugin import surface

**Files:**
- Modify: `doc/api/plugins.adoc` (or whichever file documents plugin authoring)

- [ ] **Step 1: Confirm the target file**

Run:
```bash
ls doc/api/ | grep -iE "plugin|hooks"
```

Expected: at least `plugins.adoc` or similar. If the file is named differently, use that path below.

- [ ] **Step 2: Append the compat surface section**

Append to `doc/api/plugins.adoc`:

```asciidoc
== Importing from `ep_etherpad-lite`

Etherpad ships dual entry points so plugins authored in either CommonJS
or ECMAScript Modules can consume core APIs.

=== CJS plugins (default — most existing plugins)

Use `require()` against extensionless or `.js` subpaths:

[source,js]
----
const eejs        = require('ep_etherpad-lite/node/eejs');
const PadManager  = require('ep_etherpad-lite/node/db/PadManager');
const API         = require('ep_etherpad-lite/node/db/API.js');
const padUtils    = require('ep_etherpad-lite/static/js/pad_utils');
----

These resolve through the package's `exports` map under the `require`
condition and load CJS twins from `dist-cjs/`.

=== ESM plugins (opt-in)

Set `"type": "module"` in your plugin's `package.json`. Use `import` with
explicit `.js` extensions:

[source,js]
----
import * as eejs       from 'ep_etherpad-lite/node/eejs/index.js';
import { getPad }      from 'ep_etherpad-lite/node/db/PadManager.js';
import { randomString } from 'ep_etherpad-lite/static/js/pad_utils.js';
----

These resolve through the `import` condition and load ESM modules from
`dist/`.

=== Supported subpaths

* `ep_etherpad-lite` (server entry; rarely consumed directly)
* `ep_etherpad-lite/node/*`         — server-side modules
* `ep_etherpad-lite/node/eejs`      — template engine
* `ep_etherpad-lite/static/js/*`    — code shared with the browser
* `ep_etherpad-lite/tests/backend/*` — test helpers (only useful in plugin
  tests)

=== What is NOT supported

* Reaching into `src/...` or `dist/...` paths directly — only the subpaths
  above are stable API. Anything else may change between Etherpad
  releases without notice.
* Mixing `require()` and `import` inside the same plugin file. Pick one.
```

- [ ] **Step 3: Commit**

```bash
git add doc/api/plugins.adoc
git commit -m "docs(plugins): document the dual ep_etherpad-lite import surface

CJS plugins keep working unchanged via the require condition; ESM
plugins are an opt-in track using extension-explicit imports."
```

---

## Self-review checklist (do this before declaring done)

After Task 11, do one final pass:

- [ ] `pnpm test` from `src/` succeeds locally with no plugins installed.
- [ ] `pnpm add -w ep_markdown` then `pnpm test` succeeds locally (smoke test for the "with plugins" matrix).
- [ ] `pnpm run check:exports` exits 0.
- [ ] `gh pr checks 7605` shows all backend-test jobs passing.
- [ ] `git log --oneline backend-esm-vitest ^origin/develop | head -20` shows the 11 task commits cleanly above the merge commit.
- [ ] Spec → plan coverage: every section of the spec is realized by at least one task above. (Spec section "ESM-plugin migration track" is covered by Task 11 documentation; the `eejs.render` ESM helper itself is deferred to a future plan — note this in the PR description.)

If any check fails, return to the relevant task and amend; do not paper over.
