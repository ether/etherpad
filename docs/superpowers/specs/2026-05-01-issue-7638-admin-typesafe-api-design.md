# Issue 7638 — Typesafe Admin API Client + TanStack Query Rails

**Status:** design approved 2026-05-01
**Issue:** https://github.com/ether/etherpad/issues/7638
**Related:** #7601 (introduces new admin REST sites that will adopt these rails)

## Goal

Lay down the toolchain and runtime rails for a typesafe, OpenAPI-derived admin
API client backed by TanStack Query. Do not migrate any existing call sites.

## Why rails-only

The issue's framing ("migrate every `useEffect`+`fetch` site") overstates what is
actually present in `admin/src/` today.

- The only REST `fetch()` sites are `App.tsx` and `LoginScreen.tsx` (both POST to
  `/admin-auth/`) and `i18n.ts` (locale loading).
- All admin pages with real data flow (Settings, Plugins, Pads, Shout) run over
  socket.io + zustand, not REST.
- The OpenAPI spec produced by `src/node/hooks/express/openapi.ts` only covers
  the public Etherpad HTTP API under `/api/{version}/*`. It documents zero admin
  endpoints — no `/admin-auth/`, no future `/admin/*` REST endpoints from #7601.

So the generated client has nothing in `admin/src/` to type today. The value of
landing this PR now is to get the rails in place so #7601 (and any subsequent
admin REST work) can adopt them on day one.

A separate issue will be filed to add admin endpoint coverage to the OpenAPI
spec; until that lands, no migrations are useful.

## Out of scope

- Admin endpoint coverage in the OpenAPI spec (separate issue).
- Migrating any existing `fetch()` call site.
- Backend changes.
- Pad-side frontend.

## Toolchain

| Package                          | Type           | Purpose                                  |
| -------------------------------- | -------------- | ---------------------------------------- |
| `openapi-typescript`             | devDependency  | Generates `.d.ts` from the OpenAPI spec  |
| `openapi-fetch`                  | dependency     | Typed `fetch` wrapper                    |
| `openapi-react-query`            | dependency     | TanStack Query bindings over the client  |
| `@tanstack/react-query`          | dependency     | Query runtime                            |
| `@tanstack/react-query-devtools` | dependency     | Dev-only devtools panel                  |

All added to `admin/package.json`. No version pinning beyond standard caret
ranges; pick the latest stable at implementation time.

## Codegen (option 3, hybrid)

One checked-in artifact, CI-enforced freshness.

### Script: `admin/scripts/gen-api.mjs`

1. Imports the spec-building entry point from
   `src/node/hooks/express/openapi.ts` (or a thin wrapper module that calls
   the spec builder without booting Express). Writes the resulting spec JSON
   to a temp file in `os.tmpdir()`.
2. Shells out:
   `openapi-typescript <tmp> -o admin/src/api/schema.d.ts`.
3. Prepends a generated header comment to the output:
   `// GENERATED — do not edit. Run \`pnpm gen:api\` to regenerate.`
4. Removes the temp file.

If `openapi.ts` cannot be loaded as an ES module without side effects (e.g.
because it imports settings or boots an Express app at import time), the
implementation must extract the pure spec-builder into a dedicated module so
the script can call it cleanly. That refactor is in scope; the touch should be
minimal.

### Wiring

- `admin/package.json`:
  - `"scripts": { "gen:api": "node scripts/gen-api.mjs", ... }`.
  - `"build"` is amended to run `gen:api` before `tsc && vite build` so a
    fresh checkout builds without manual steps.
- Root `package.json`: existing admin build entry point invokes the same
  script (or relies on `admin/package.json`'s amended `build`).

### Generated output

- Path: `admin/src/api/schema.d.ts`.
- Checked in.
- First line: generated-header comment.

### CI freshness check

A CI job (folded into the existing admin lint workflow if practical, otherwise
a new step) runs:

```bash
pnpm --filter admin gen:api
git diff --exit-code admin/src/api/schema.d.ts
```

If the diff is non-empty, CI fails with a message instructing the contributor
to run `pnpm --filter admin gen:api` and commit the result.

## Runtime client

### `admin/src/api/client.ts`

```ts
import createClient from "openapi-fetch";
import createQueryHooks from "openapi-react-query";
import type { paths } from "./schema";

export const fetchClient = createClient<paths>({ baseUrl: "/" });
export const $api = createQueryHooks(fetchClient);
```

### `admin/src/api/QueryProvider.tsx`

- Wraps children in `QueryClientProvider`.
- Single shared `QueryClient` constructed once (module-level or `useState`
  initializer), with defaults:
  - `staleTime: 30_000`
  - `refetchOnWindowFocus: true`
  - Other defaults left at library defaults.
- Mounts `ReactQueryDevtools` only when `import.meta.env.DEV` is true. Use a
  dynamic `import()` so devtools do not ship in the production bundle.

### `admin/src/main.tsx`

Wrap `<App />` in `<QueryProvider>`. No other changes.

## Documentation

`admin/README.md` (create or extend) documents:

- How to regenerate: `pnpm --filter admin gen:api`.
- When to regenerate: after any change to `src/node/hooks/express/openapi.ts`
  or anything that affects the spec it builds.
- What gets regenerated: `admin/src/api/schema.d.ts` only.
- The CI freshness check and how to recover from a failing check.
- A short "how to use the client" snippet showing
  `$api.useQuery("get", "/some/path")` once admin endpoints are in the spec.

## Tests

- **Module-load smoke test** (`admin/src/api/__tests__/client.test.ts` or
  similar, matching whatever test infra `admin/` already uses): imports
  `$api` and `fetchClient`, asserts both are defined. This catches toolchain
  wiring breakage (missing peer deps, bad export shape, etc.).
- **CI freshness check** (above) is the test for spec/schema sync.
- **Manual smoke after PR install:** install the branch on the local
  Etherpad, open `/admin`, confirm:
  - Existing socket.io flows (settings, plugins, pads) still work — no
    regressions from the `<QueryProvider>` wrap.
  - React Query devtools panel appears in a dev build (`pnpm --filter admin
    dev`) and is absent from a production build.

Note: per project convention, the user expects automated tests before manual
verification, but the manual smoke is unavoidable here because devtools
visibility and provider wrap are runtime concerns. The smoke check is a
secondary safety net, not the primary test strategy.

## Branch / PR plan

- Fork: `johnmclear/etherpad-lite` (per project convention; never commit
  directly to `ether/etherpad-lite`).
- Branch: `chore/admin-typesafe-api-7638`.
- Base: latest `main` of the fork, after syncing from `ether/etherpad-lite`.
- PR title: `chore(admin): typesafe API client + TanStack Query rails`.
- PR body declares semver: **patch** (build tooling + unused runtime libs;
  no observable behavior change).
- PR body links #7638 and notes:
  - Rails-only — no call site migrations.
  - Separate spec-coverage issue to follow.
  - #7601 should rebase onto this branch once merged.

## Risks

- **`openapi.ts` not cleanly importable.** If pulling the spec builder out
  requires touching production paths, that risk needs a small refactor PR
  first. Mitigation: keep the extraction surgical; if it grows, split into
  its own PR and rebase 7638 on top.
- **Bundle size.** TanStack Query + react-query bindings add ~12 KB gzipped
  to the admin bundle even with no call sites using it. Acceptable for an
  internal admin UI; flag in PR body for transparency.
- **Provider wrap regressions.** `<QueryProvider>` wrapping `<App />` should
  be inert for socket.io paths but the manual smoke confirms.

## Definition of done

- `pnpm --filter admin gen:api` runs cleanly on a fresh checkout.
- `pnpm --filter admin build` succeeds.
- `admin/src/api/schema.d.ts` is checked in with the generated header.
- `<QueryProvider>` wraps `<App />`; devtools visible in dev, absent in
  production build.
- CI freshness check is wired and passing.
- `admin/README.md` documents the codegen workflow.
- Manual smoke confirms no regression in existing socket.io-driven pages.
- PR opened against `johnmclear/etherpad-lite`, semver labelled patch,
  Qodo `/review` triggered after push.
