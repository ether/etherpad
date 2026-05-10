# Issue 7638 — Typesafe Admin API Client + TanStack Query Rails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay down the codegen toolchain, runtime client, and TanStack Query provider for the admin UI. No call-site migrations.

**Architecture:** A small Node script imports the OpenAPI spec builder from `src/node/hooks/express/openapi.ts`, writes the JSON to a temp file, and runs `openapi-typescript` to produce a checked-in `admin/src/api/schema.d.ts`. The runtime exposes a typed `openapi-fetch` client and `openapi-react-query` hooks via `admin/src/api/client.ts`, mounted under a `<QueryProvider>` at the admin root. CI re-runs codegen and fails if the working tree is dirty.

**Tech Stack:** TypeScript, React 19, Vite (rolldown-vite), `openapi-typescript`, `openapi-fetch`, `openapi-react-query`, `@tanstack/react-query`, `@tanstack/react-query-devtools`, `tsx` (devDep, runs the codegen script against TS source).

**Spec:** `docs/superpowers/specs/2026-05-01-issue-7638-admin-typesafe-api-design.md`

**Branch:** `chore/admin-typesafe-api-7638` (already cut off `origin/develop`, design doc committed as `41d2babf4`).

**Working directory for all commands:** `/home/jose/etherpad/etherpad-lite` unless otherwise stated.

---

## File Structure

**Create:**
- `admin/scripts/gen-api.mjs` — orchestrator script. Invokes `tsx` to run a small TS entry that prints the spec JSON, captures stdout to a temp file, then shells out to `openapi-typescript`.
- `admin/scripts/dump-spec.ts` — TS entry that imports `generateDefinitionForVersion` from the etherpad source and writes the JSON to stdout.
- `admin/src/api/schema.d.ts` — generated. Checked in.
- `admin/src/api/client.ts` — `openapi-fetch` + `openapi-react-query` instances.
- `admin/src/api/QueryProvider.tsx` — TanStack Query provider, dev-only devtools.
- `admin/src/api/__tests__/client.test.ts` — module-load smoke test.
- `admin/README.md` — codegen docs (file does not currently exist).

**Modify:**
- `src/node/hooks/express/openapi.ts` — add `export { generateDefinitionForVersion }` at the end so external scripts can call the spec builder. Surgical change, no behavior delta.
- `admin/package.json` — add deps and `gen:api` script; amend `build` to run `gen:api` first.
- `admin/src/main.tsx` — wrap router subtree in `<QueryProvider>`.
- `.github/workflows/frontend-admin-tests.yml` — add a freshness-check step before the existing admin build step.

**Conventions to honor:**
- Per project memory, the PR will go to `johnmclear/etherpad-lite`, not `ether/etherpad-lite`.
- Commit at the end of each task.
- Run `pnpm ts-check` and admin's lint at the end before declaring done.

---

## Task 1: Export the spec builder from `openapi.ts`

**Files:**
- Modify: `src/node/hooks/express/openapi.ts:422` (and end of file)

The script needs to call `generateDefinitionForVersion` from outside the module. It is currently only used within the file. Adding a CommonJS-style export keeps the existing `exports.expressPreSession` style consistent.

- [ ] **Step 1: Read the current export style at the bottom of the file**

Run: `grep -n "^exports\." src/node/hooks/express/openapi.ts`
Expected output: a line like `578:exports.expressPreSession = async (hookName:string, {app}:any) => {`

- [ ] **Step 2: Add the export**

Append at the end of `src/node/hooks/express/openapi.ts` (after the existing hook export, after line 771):

```ts
exports.generateDefinitionForVersion = generateDefinitionForVersion;
exports.APIPathStyle = APIPathStyle;
```

(Both are needed: the script will call `generateDefinitionForVersion(apiHandler.latestApiVersion, APIPathStyle.FLAT)` and we want a single import surface.)

- [ ] **Step 3: Verify ts-check still passes**

Run: `pnpm ts-check`
Expected: no new errors. (If pre-existing errors are present, confirm none are in `openapi.ts`.)

- [ ] **Step 4: Commit**

```bash
git add src/node/hooks/express/openapi.ts
git commit -m "$(cat <<'EOF'
feat(api): export generateDefinitionForVersion from openapi hook

Required by the admin codegen script (#7638) to dump the OpenAPI spec
without booting Express. No behavior change for the request hook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add admin dependencies

**Files:**
- Modify: `admin/package.json`

- [ ] **Step 1: Read the current `admin/package.json`**

Run: `cat admin/package.json`
Expected: confirm there is a `dependencies` block and a `devDependencies` block.

- [ ] **Step 2: Install runtime deps**

Run:
```bash
pnpm --filter admin add @tanstack/react-query @tanstack/react-query-devtools openapi-fetch openapi-react-query
```
Expected: deps added under `dependencies`. `pnpm-lock.yaml` updated at repo root.

- [ ] **Step 3: Install dev deps**

Run:
```bash
pnpm --filter admin add -D openapi-typescript tsx
```
Expected: deps added under `devDependencies`.

- [ ] **Step 4: Sanity check the diff**

Run: `git diff admin/package.json`
Expected: six new entries (4 deps, 2 devDeps), no other changes.

- [ ] **Step 5: Commit**

```bash
git add admin/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(admin): add OpenAPI codegen + TanStack Query deps (#7638)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Write the spec-dump entry

**Files:**
- Create: `admin/scripts/dump-spec.ts`

This file is intentionally tiny. It runs under `tsx` so it can resolve the etherpad-lite TypeScript source directly.

- [ ] **Step 1: Create the file**

```ts
// admin/scripts/dump-spec.ts
//
// Imports the OpenAPI spec builder from the etherpad source and writes the
// flat-style spec for the latest API version as JSON to stdout. Invoked by
// admin/scripts/gen-api.mjs via `tsx`.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(__dirname, '..', '..');

// `openapi.ts` uses CommonJS-style `exports.*` despite living in an ESM repo,
// so we go through createRequire to load it cleanly.
import { createRequire } from 'node:module';
const require = createRequire(pathToFileURL(path.join(repoRoot, 'src', 'node', 'hooks', 'express', 'openapi.ts')).toString());

const apiHandler = require('../../src/node/handler/APIHandler');
const { generateDefinitionForVersion, APIPathStyle } =
  require('../../src/node/hooks/express/openapi') as {
    generateDefinitionForVersion: (version: string, style?: string) => unknown;
    APIPathStyle: { FLAT: string; REST: string };
  };

const spec = generateDefinitionForVersion(apiHandler.latestApiVersion, APIPathStyle.FLAT);
process.stdout.write(JSON.stringify(spec, null, 2));
```

- [ ] **Step 2: Smoke-test the entry**

Run:
```bash
cd admin && pnpm exec tsx scripts/dump-spec.ts > /tmp/etherpad-spec.json
echo "exit: $?"
head -c 200 /tmp/etherpad-spec.json
```
Expected: exit 0; the head output starts with `{` and contains `"openapi"` and `"paths"`.

If the script fails because importing `openapi.ts` triggers errors from `Settings`, debug by running `pnpm exec tsx -e "require('../src/node/hooks/express/openapi.ts')"` from `admin/` to isolate. The most likely fix is to set `EP_LOG_DESTINATION=stderr` or similar; do not refactor `Settings` from this PR — note the issue and ask before expanding scope.

- [ ] **Step 3: Commit**

```bash
git add admin/scripts/dump-spec.ts
git commit -m "$(cat <<'EOF'
chore(admin): add OpenAPI spec dump entry (#7638)

Loaded via tsx by gen-api.mjs in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Write the codegen orchestrator

**Files:**
- Create: `admin/scripts/gen-api.mjs`

- [ ] **Step 1: Create the file**

```js
// admin/scripts/gen-api.mjs
//
// Regenerates admin/src/api/schema.d.ts from the live OpenAPI spec exported
// by src/node/hooks/express/openapi.ts. Run via `pnpm --filter admin gen:api`.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(here, '..');
const outFile = path.join(adminRoot, 'src', 'api', 'schema.d.ts');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'etherpad-openapi-'));
const specPath = path.join(tmpDir, 'spec.json');

try {
  const dump = spawnSync('pnpm', ['exec', 'tsx', 'scripts/dump-spec.ts'], {
    cwd: adminRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (dump.status !== 0) {
    console.error(`dump-spec.ts failed with exit code ${dump.status}`);
    process.exit(dump.status ?? 1);
  }
  writeFileSync(specPath, dump.stdout, 'utf8');

  const gen = spawnSync(
    'pnpm',
    ['exec', 'openapi-typescript', specPath, '-o', outFile],
    { cwd: adminRoot, stdio: 'inherit' },
  );
  if (gen.status !== 0) {
    console.error(`openapi-typescript failed with exit code ${gen.status}`);
    process.exit(gen.status ?? 1);
  }

  const header =
    `// GENERATED — do not edit. Run \`pnpm --filter admin gen:api\` to regenerate.\n` +
    `// Source: src/node/hooks/express/openapi.ts (#7638)\n\n`;
  const body = readFileSync(outFile, 'utf8');
  writeFileSync(outFile, header + body, 'utf8');

  console.log(`Wrote ${path.relative(process.cwd(), outFile)}`);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Add the `gen:api` script and amend `build`**

In `admin/package.json`, edit the `scripts` block. Before:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
  "build-copy": "tsc && vite build --outDir ../src/templates/admin --emptyOutDir",
  "preview": "vite preview"
}
```

After:

```json
"scripts": {
  "dev": "vite",
  "gen:api": "node scripts/gen-api.mjs",
  "build": "pnpm gen:api && tsc && vite build",
  "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
  "build-copy": "pnpm gen:api && tsc && vite build --outDir ../src/templates/admin --emptyOutDir",
  "preview": "vite preview"
}
```

- [ ] **Step 3: Run codegen and confirm output**

Run:
```bash
mkdir -p admin/src/api
pnpm --filter admin gen:api
ls -la admin/src/api/schema.d.ts
head -10 admin/src/api/schema.d.ts
```
Expected:
- exit 0
- `schema.d.ts` exists, > 1 KB
- first two lines are the generated header
- subsequent lines contain `export interface paths` and entries like `"/api/{version}/createGroup"`

- [ ] **Step 4: Commit script + package.json + generated schema**

```bash
git add admin/scripts/gen-api.mjs admin/package.json admin/src/api/schema.d.ts
git commit -m "$(cat <<'EOF'
chore(admin): wire OpenAPI codegen into build (#7638)

Adds `gen:api` script and amends `build`/`build-copy` to regenerate
admin/src/api/schema.d.ts before compiling. The generated file is
checked in so it shows up in PR review and so a fresh checkout doesn't
need codegen to typecheck.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Runtime client module

**Files:**
- Create: `admin/src/api/client.ts`

- [ ] **Step 1: Create the file**

```ts
// admin/src/api/client.ts
//
// Typed HTTP client and TanStack Query hooks derived from the generated
// OpenAPI schema. Regenerate the schema with `pnpm --filter admin gen:api`.

import createClient from 'openapi-fetch';
import createQueryHooks from 'openapi-react-query';
import type { paths } from './schema';

export const fetchClient = createClient<paths>({ baseUrl: '/' });
export const $api = createQueryHooks(fetchClient);
```

- [ ] **Step 2: Confirm typecheck passes**

Run: `pnpm --filter admin exec tsc --noEmit`
Expected: no errors. If `paths` is missing from `schema.d.ts`, rerun `pnpm --filter admin gen:api` (it should have produced an `export interface paths` already in Task 4).

- [ ] **Step 3: Commit**

```bash
git add admin/src/api/client.ts
git commit -m "$(cat <<'EOF'
feat(admin): typed openapi-fetch + react-query client (#7638)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Query provider with dev-only devtools

**Files:**
- Create: `admin/src/api/QueryProvider.tsx`

- [ ] **Step 1: Create the file**

```tsx
// admin/src/api/QueryProvider.tsx
//
// TanStack Query provider for the admin UI. Devtools are loaded lazily and
// only in dev builds so they don't ship to production.

import { lazy, Suspense, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const Devtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    )
  : null;

export const QueryProvider = ({ children }: { children: ReactNode }) => {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      {Devtools && (
        <Suspense fallback={null}>
          <Devtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter admin exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add admin/src/api/QueryProvider.tsx
git commit -m "$(cat <<'EOF'
feat(admin): TanStack Query provider, dev-only devtools (#7638)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Mount the provider at the admin root

**Files:**
- Modify: `admin/src/main.tsx`

- [ ] **Step 1: Read the file to confirm current shape**

Run: `cat admin/src/main.tsx`
Expected: matches the structure where `<I18nextProvider>` wraps `<Toast.Provider>` wraps `<RouterProvider>` inside `<React.StrictMode>`.

- [ ] **Step 2: Edit `admin/src/main.tsx`**

Add the import after the existing imports:

```tsx
import { QueryProvider } from './api/QueryProvider.tsx';
```

Wrap the existing `<I18nextProvider>...</I18nextProvider>` subtree in `<QueryProvider>`. The render block becomes:

```tsx
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryProvider>
      <I18nextProvider i18n={i18n}>
        <Toast.Provider>
          <ToastDialog/>
          <RouterProvider router={router}/>
        </Toast.Provider>
      </I18nextProvider>
    </QueryProvider>
  </React.StrictMode>,
)
```

(Provider order matters only for context lookups; placing `QueryProvider` outside `I18nextProvider` is fine because it does not consume i18n.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter admin exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build the admin bundle**

Run: `pnpm --filter admin run build`
Expected: build succeeds. Output indicates one bundle (no extra chunk for devtools in production — confirm by grepping the `dist/` for `query-devtools` strings; should be absent).

```bash
grep -rn "ReactQueryDevtools" admin/dist/ 2>/dev/null | head
```
Expected: no matches (production bundle excludes devtools).

- [ ] **Step 5: Commit**

```bash
git add admin/src/main.tsx
git commit -m "$(cat <<'EOF'
feat(admin): mount TanStack Query provider at root (#7638)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Smoke test for the client module

**Files:**
- Create: `admin/src/api/__tests__/client.test.ts`

The admin package does not yet ship a unit test runner. Reuse whatever the rest of admin uses for tests if anything; otherwise, this test runs under `tsx --test` (Node's built-in test runner, no extra deps). Confirm at Step 1.

- [ ] **Step 1: Detect the test runner**

Run:
```bash
grep -E '"(test|vitest|jest)"' admin/package.json
ls admin/vitest.config.* admin/jest.config.* 2>/dev/null
```

If admin has no runner configured, use Node's built-in `node:test` (which `tsx` supports).

- [ ] **Step 2: Create the test file**

```ts
// admin/src/api/__tests__/client.test.ts
//
// Smoke test that the OpenAPI client module loads and exposes the expected
// surface. Catches toolchain wiring regressions (missing peer deps,
// generator output that doesn't export `paths`, etc.).

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('client module exports fetchClient and $api', async () => {
  const mod = await import('../client.ts');
  assert.ok(mod.fetchClient, 'fetchClient export is present');
  assert.ok(mod.$api, '$api export is present');
  assert.equal(typeof mod.fetchClient.GET, 'function', 'fetchClient.GET is a function');
  assert.equal(typeof mod.$api.useQuery, 'function', '$api.useQuery is a function');
});
```

- [ ] **Step 3: Add a `test` script to `admin/package.json`** (only if one does not already exist)

If `admin/package.json` has no `"test"` script, add:

```json
"test": "tsx --test src/api/__tests__/client.test.ts"
```

If admin already has a test runner (e.g. `vitest`), skip the script addition and instead place the test at the location the existing runner picks up (`*.test.ts` is conventional for both vitest and node:test).

- [ ] **Step 4: Run the test**

Run: `pnpm --filter admin test`
Expected: 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add admin/src/api/__tests__/client.test.ts admin/package.json
git commit -m "$(cat <<'EOF'
test(admin): smoke test for typed openapi-fetch client (#7638)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: CI freshness check

**Files:**
- Modify: `.github/workflows/frontend-admin-tests.yml`

Add a step before the existing `Build admin frontend` step that runs codegen and fails if the working tree changed.

- [ ] **Step 1: Read the current workflow**

Run: `grep -n "Build admin frontend" .github/workflows/frontend-admin-tests.yml`
Expected: a single match around the build step that runs `pnpm run build` from `working-directory: admin`.

- [ ] **Step 2: Insert the freshness check**

Insert immediately before the `Build admin frontend` step:

```yaml
      - name: Verify admin OpenAPI schema is up to date
        working-directory: admin
        run: |
          pnpm gen:api
          if ! git diff --exit-code src/api/schema.d.ts; then
            echo ""
            echo "::error::admin/src/api/schema.d.ts is out of date."
            echo "Run \`pnpm --filter admin gen:api\` and commit the result."
            exit 1
          fi
```

- [ ] **Step 3: Lint the YAML**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/frontend-admin-tests.yml'))" && echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/frontend-admin-tests.yml
git commit -m "$(cat <<'EOF'
ci(admin): verify generated OpenAPI schema is up to date (#7638)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Documentation

**Files:**
- Create: `admin/README.md`

- [ ] **Step 1: Create the file**

```markdown
# Admin UI

Vite + React 19 single-page app served at `/admin`. Talks to the backend over
socket.io for the existing settings / plugins / pads pages, and (when
endpoints are added to the OpenAPI spec) over a typed REST client.

## Scripts

| Script               | What it does                                             |
| -------------------- | -------------------------------------------------------- |
| `pnpm dev`           | Vite dev server. Expects an etherpad backend on :9001.   |
| `pnpm gen:api`       | Regenerates `src/api/schema.d.ts` from the OpenAPI spec. |
| `pnpm build`         | `gen:api` + `tsc` + `vite build`.                        |
| `pnpm build-copy`    | Same, but writes into `../src/templates/admin`.          |
| `pnpm test`          | Smoke tests for the API client wiring.                   |
| `pnpm lint`          | ESLint.                                                  |

## Typed API client

The admin uses [`openapi-typescript`] to generate types from
`src/node/hooks/express/openapi.ts`, [`openapi-fetch`] for typed requests, and
[`openapi-react-query`] for TanStack Query bindings.

[`openapi-typescript`]: https://github.com/openapi-ts/openapi-typescript
[`openapi-fetch`]: https://github.com/openapi-ts/openapi-typescript/tree/main/packages/openapi-fetch
[`openapi-react-query`]: https://github.com/openapi-ts/openapi-typescript/tree/main/packages/openapi-react-query

### Regenerating the schema

```sh
pnpm --filter admin gen:api
```

This runs `admin/scripts/gen-api.mjs`, which loads
`src/node/hooks/express/openapi.ts`, calls `generateDefinitionForVersion` for
the latest API version, pipes the JSON through `openapi-typescript`, and
writes the result to `admin/src/api/schema.d.ts`. The generated file is
checked in.

Run `gen:api` after any change to:

- `src/node/hooks/express/openapi.ts`
- `src/node/handler/APIHandler.ts` (changes to `latestApiVersion`)
- the resource definitions referenced by `openapi.ts`

### CI freshness check

`.github/workflows/frontend-admin-tests.yml` runs `pnpm gen:api` and fails the
build if `admin/src/api/schema.d.ts` is out of date. If you see the failure
locally, run `pnpm --filter admin gen:api` and commit the regenerated file.

### Using the client

```tsx
import { $api } from './api/client';

const SettingsPanel = () => {
  const { data } = $api.useQuery('get', '/admin/settings'); // example
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
};
```

The admin endpoints are not yet present in the OpenAPI spec — this client is
in place to support upcoming work (see issue #7638 follow-up). For now, it is
exercised only by the smoke test.
```

- [ ] **Step 2: Commit**

```bash
git add admin/README.md
git commit -m "$(cat <<'EOF'
docs(admin): document OpenAPI codegen workflow (#7638)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Full verification pass

No new files — this task confirms the work is green end-to-end before pushing.

- [ ] **Step 1: Clean rebuild**

Run:
```bash
pnpm --filter admin gen:api
pnpm --filter admin run build
```
Expected: both succeed.

- [ ] **Step 2: Repo-wide typecheck**

Run: `pnpm ts-check`
Expected: no new errors versus baseline. If there are pre-existing errors, confirm none are in files this PR touched.

- [ ] **Step 3: Admin tests**

Run: `pnpm --filter admin test`
Expected: 1 test passing.

- [ ] **Step 4: Backend unit tests** (sanity — `openapi.ts` change)

Run: `pnpm test` (or the narrowest available suite covering the API hook; if the full suite is slow, run specs that exercise `openapi.ts` only).
Expected: green.

- [ ] **Step 5: Confirm devtools absent from production bundle**

Run: `grep -rn "ReactQueryDevtools" admin/dist/ 2>/dev/null`
Expected: zero matches.

- [ ] **Step 6: Manual smoke**

Per project convention (memory: install plugin/branch for manual test), install this branch on a local etherpad and:
- Open `/admin/` in a dev build (`pnpm --filter admin dev`). Confirm the React Query devtools panel button appears in the bottom corner.
- Open `/admin/` in the production-built bundle. Confirm devtools panel is absent.
- Click through plugins / settings / pads / shout pages and confirm no regression versus pre-PR behavior (existing socket.io flows unchanged).

Document the smoke results in the PR description.

- [ ] **Step 7: Push**

```bash
git push -u fork chore/admin-typesafe-api-7638
```

- [ ] **Step 8: Open PR**

```bash
gh pr create \
  --repo johnmclear/etherpad-lite \
  --title "chore(admin): typesafe API client + TanStack Query rails (#7638)" \
  --body "$(cat <<'EOF'
## Summary

Lays down the rails for a typesafe, OpenAPI-derived admin API client backed by TanStack Query. Closes #7638.

- Codegen toolchain (`pnpm --filter admin gen:api`) producing `admin/src/api/schema.d.ts` from `src/node/hooks/express/openapi.ts`.
- Runtime client (`openapi-fetch` + `openapi-react-query`).
- `<QueryProvider>` mounted at the admin root with dev-only devtools.
- CI freshness check on the generated schema.
- `admin/README.md` documenting the workflow.

**No call sites migrated.** Admin endpoints aren't in the OpenAPI spec yet — that gap is filed as a follow-up issue and must land before any migration is useful. #7601 should rebase onto this branch.

**Semver:** patch — build tooling + currently-unused runtime libs, no observable behavior change.

## Test plan

- [x] `pnpm --filter admin gen:api` runs clean
- [x] `pnpm --filter admin run build` succeeds
- [x] `pnpm --filter admin test` passes (smoke test)
- [x] `pnpm ts-check` clean
- [x] Production bundle does not contain devtools
- [x] Manual smoke: dev build shows devtools, prod build hides them, existing socket.io pages unaffected

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9: Trigger Qodo review** (per project convention)

```bash
gh pr comment <PR-number> --repo johnmclear/etherpad-lite --body "/review"
```

- [ ] **Step 10: File the spec-coverage follow-up issue**

Create a new issue on `ether/etherpad` titled "Document admin endpoints in the OpenAPI spec" and link from the PR body. The issue should note that 7638 rails are unused until admin endpoints are added.

---

## Risk register (carried from spec)

- **`openapi.ts` not cleanly importable.** If `dump-spec.ts` fails to import the module due to side effects (Settings, log4js init), pause and ask before refactoring `Settings`. A common workaround is to set `EP_LOG_DESTINATION=stderr` or set `NODE_ENV=production`. Do not silently expand scope.
- **Generated schema differs by Node version.** `openapi-typescript` output is deterministic, but if a contributor sees a phantom diff, confirm Node major matches the CI matrix (22/24/25 today; CI uses 24 on PRs).
- **Bundle size.** ~12 KB gzipped added to the admin bundle even with no call sites. Acceptable; flagged in the PR body for transparency.

## Out of scope (do not pull in)

- Adding admin endpoints to the OpenAPI spec.
- Migrating any `fetch()` site in `admin/src/`.
- Backend handler changes.
- Pad-side frontend changes.
