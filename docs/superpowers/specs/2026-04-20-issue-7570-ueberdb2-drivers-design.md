# Design: Fix #7570 — `Cannot find module 'mysql2'` in Docker production image

Upstream: <https://github.com/ether/etherpad-lite/issues/7570>

## Problem

`ueberdb2@5.0.45` moved its ten database driver dependencies from normal
`dependencies` to `peerDependencies` with `peerDependenciesMeta.optional = true`.
Production `pnpm install` in the Etherpad Docker image does not install
optional peer dependencies, so the drivers are absent. At startup,
`ueberdb2`'s driver loader does `require('mysql2')` (or the configured
driver) and crashes:

```
Error: Cannot find module 'mysql2'
Require stack:
- /opt/etherpad-lite/node_modules/.pnpm/ueberdb2@5.0.45/node_modules/ueberdb2/dist/mysql_db-*.js
- /opt/etherpad-lite/node_modules/.pnpm/ueberdb2@5.0.45/node_modules/ueberdb2/dist/index.js
- /opt/etherpad-lite/src/node/db/DB.ts
```

The bug affects every non-default DB backend (mysql, postgres, mongodb,
mssql, redis, couchdb, cassandra, elasticsearch, rethinkdb, surrealdb).
The reporter hit it with MySQL because MySQL is the most common prod
backend; the class of failure is identical for the other nine.

The earlier Copilot PR #7571 attempted a fix but (a) initially only listed
`mysql2`, (b) now lists all ten but only regression-tests MySQL in CI,
and (c) accumulated unrelated scope (bumps to `typescript`,
`oidc-provider`, `eslint-config-etherpad`, `@types/express-session`,
`resolve`; firefox removed from `test-admin`; a repo URL change; a
docker.yml restructure that collides with the already-merged GHCR PR
#7569). This spec replaces it.

## Goals

1. Restore Docker prod startup for every supported DB backend.
2. Prevent the same class of regression from silently returning.
3. Keep the downstream diff minimal and reviewable.

## Non-goals

- Refactoring ueberdb2 to a plugin-per-driver architecture.
- Changing which backends Etherpad officially supports.
- Addressing other unrelated dependency bumps.

## Architecture

Two independent changes that stack:

**Upstream fix (`ether/ueberDB`)** — the real "reintroduce bundling."
Move the ten DB drivers from `peerDependencies` + `peerDependenciesMeta`
back to `dependencies`. Publish as a new patch version. Restores
pre-5.0.45 behavior where `npm install ueberdb2` pulls the drivers.

**Downstream fix (`ether/etherpad-lite`)** — bump `ueberdb2` to the new
version, additionally declare the ten drivers as direct `dependencies`
in `src/package.json` as a defensive safety net, and add a CI regression
test that would have caught #7570.

The downstream driver listing is redundant on a good day and
load-bearing on a bad day: if a future ueberdb2 release drifts the
peer-vs-dep classification again, Etherpad stays buildable and the CI
job reports the drift loudly rather than only at Docker startup in
production.

## Upstream change (`ether/ueberDB`)

**File:** `package.json`

1. Move these ten entries from `peerDependencies` → `dependencies`,
   preserving version ranges exactly as currently declared in 5.0.45:
   - `@elastic/elasticsearch` `^9.3.4`
   - `cassandra-driver` `^4.8.0`
   - `mongodb` `^7.1.1`
   - `mssql` `^12.2.1`
   - `mysql2` `^3.22.0`
   - `nano` `^11.0.5`
   - `pg` `^8.20.0`
   - `redis` `^5.12.1`
   - `rethinkdb` `^2.4.2`
   - `surrealdb` `^2.0.3`
2. Delete the `peerDependenciesMeta` block entirely.
3. Version bump: `5.0.45` → `5.0.46`.

**Tradeoff accepted:** every ueberdb2 consumer now installs ~250 MB of
driver code regardless of which backend they use. This is the pre-5.0.45
behavior, is what Etherpad needs, and avoids a larger
plugin-per-driver refactor.

**Verification:** ueberdb2's existing vitest + testcontainers suite
exercises every driver end-to-end. If the migration is correct, CI stays
green. Nothing else needs adding upstream.

**Delivery:** PR from `johnmclear/ueberDB` fork into `ether/ueberDB`
default branch. After merge, publish `ueberdb2@5.0.46` to npm via the
existing release workflow.

## Downstream change (`ether/etherpad-lite`)

### Decision: replace PR #7571 rather than rebase

Copilot's #7571 has correct direction but mixed scope. Cleanest path is
to close it with a pointer to the replacement and open a fresh branch
off the current `ether/etherpad-lite:develop` (post #7569 merge). No
shared commits.

### `src/package.json`

- Bump `ueberdb2` → `^5.0.46`.
- Add the ten drivers to `dependencies`, with the **same version ranges
  ueberdb2 itself declares**, so the two lists can't drift on the
  range:
  - `@elastic/elasticsearch` `^9.3.4`
  - `cassandra-driver` `^4.8.0`
  - `mongodb` `^7.1.1`
  - `mssql` `^12.2.1`
  - `mysql2` `^3.22.0`
  - `nano` `^11.0.5`
  - `pg` `^8.20.0`
  - `redis` `^5.12.1`
  - `rethinkdb` `^2.4.2`
  - `surrealdb` `^2.0.3`
- No other edits. Specifically do **not** bump
  `typescript`, `oidc-provider`, `eslint-config-etherpad`,
  `@types/express-session`, or `resolve`, and do **not** change the
  `repository.url` field or the `test-admin` project list.

### `pnpm-lock.yaml`

Regenerated via `pnpm install` on the clean branch. Not cherry-picked
from #7571.

### `.github/workflows/docker.yml`

Add one new job, `build-test-db-drivers`, alongside the existing
`build-test`. **No restructuring of existing jobs.** The `publish` job's
`needs:` is extended from `[build-test]` to `[build-test, build-test-db-drivers]`
so driver regressions block publication.

The new job runs four sequential stages in a single job (so any failure
blocks `publish` via `needs:`):

1. **Build production image** — reuse the existing buildx + GHA cache
   pattern from `build-test`.

2. **Driver presence test (all ten, fast).** Run one container:
   ```
   docker run --rm "$TEST_TAG" node -e "
     const mods = [
       '@elastic/elasticsearch','cassandra-driver','mongodb','mssql',
       'mysql2','nano','pg','redis','rethinkdb','surrealdb'
     ];
     for (const m of mods) {
       try { require(m); console.log('ok', m); }
       catch (e) { console.error('MISSING', m, e.message); process.exit(1); }
     }
   "
   ```
   This is the precise regression test for the #7570 class — catches
   "driver missing from production image" for every backend in seconds.

3. **MySQL smoke test.** `mysql:8` service container, launch Etherpad
   with `DB_TYPE=mysql` against the service, poll container health for
   up to ~2 minutes, fail on unhealthy. Reproduces the issue reporter's
   scenario.

4. **Postgres smoke test.** `postgres:16` service container, same
   pattern with `DB_TYPE=postgres`. Covers the other common prod
   backend.

Stages 2–4 are the actual regression signal; stage 1 just prepares the
image they run against.

The other seven backends (mongodb, mssql, redis, couchdb/nano,
cassandra, elasticsearch, rethinkdb, surrealdb) are covered by the
presence test only. Full service-container smokes for all ten would
10× CI time and several of them (SurrealDB, RethinkDB, Cassandra) are
awkward to stand up reliably on GitHub-hosted runners. If a specific
backend regresses in practice, we upgrade its coverage then.

## Rollout order

1. Open fork PR against `ether/ueberDB` with the ten-driver move + version bump.
2. Merge and publish `ueberdb2@5.0.46` to npm.
3. Close `ether/etherpad-lite#7571` with a comment linking here.
4. Open fork PR against `ether/etherpad-lite:develop` with the
   `src/package.json` + `pnpm-lock.yaml` + `docker.yml` changes.
5. Confirm CI goes green on the new PR — specifically the MySQL stage
   of `build-test-db-drivers` is the live reproduction of #7570.

Step 4 depends on step 2 (the new `pnpm-lock.yaml` must be able to
resolve `ueberdb2@^5.0.46` from the public registry).

## Local verification before pushing

- `pnpm install` resolves cleanly with no warnings about missing peer deps.
- `docker build --target production -t etherpad:test .` succeeds.
- `docker run --rm etherpad:test node -e "<presence script>"` prints `ok` for all ten.
- `docker compose up` with the issue reporter's exact compose file
  (mariadb:11.4, `DB_TYPE=mysql`) reaches a healthy state and serves
  `/`.

## Testing

The new CI job is itself the regression test. No separate unit tests
added — the failure mode is a packaging concern, not a code-path
concern, and unit tests cannot observe it.

## Out of scope

- Reverting or auditing the unrelated bumps included in #7571. If any
  of those bumps is wanted independently, it gets its own PR.
- Reworking the Docker image to slim down the ~250 MB driver payload
  for users who only need SQLite. If this matters, future work could
  introduce a build arg that prunes unneeded drivers post-install.

## Commit targets

Per project rules, both PRs originate from `johnmclear/` forks, never
direct commits to `ether/*`. ueberDB fork to be created if it does not
already exist.
