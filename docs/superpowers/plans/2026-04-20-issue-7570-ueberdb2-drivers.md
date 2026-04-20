# Fix #7570 (ueberdb2 driver bundling) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Etherpad Docker production startup for every supported DB backend (broken by `ueberdb2@5.0.45` moving drivers to optional peer deps), and add CI that would have caught it.

**Architecture:** Two coupled PRs. Upstream PR to `ether/ueberDB` moves the 10 DB drivers back from `peerDependencies` (optional) to `dependencies` and publishes `5.0.46`. Downstream PR to `ether/etherpad-lite` bumps `ueberdb2`, declares the same 10 drivers as direct deps as a defensive safety net, and adds a `build-test-db-drivers` CI job with a require-each-driver presence check plus MySQL + Postgres smoke tests that gate publish.

**Tech Stack:** Node.js / pnpm / TypeScript, ueberdb2 KV abstraction, Docker Buildx, GitHub Actions service containers, vitest + testcontainers (upstream tests).

**Spec:** `docs/superpowers/specs/2026-04-20-issue-7570-ueberdb2-drivers-design.md`

**Conventions:**
- All pushes land on `johnmclear/` forks — never `ether/*` directly.
- The branch `fix/issue-7570-ueberdb2-drivers` already exists in `/home/jose/etherpad/etherpad-lite` with the design spec committed.
- Working dirs:
  - Downstream: `/home/jose/etherpad/etherpad-lite`
  - Upstream ueberDB will be cloned to: `/home/jose/etherpad/ueberDB`

---

## Phase A — Upstream (`ether/ueberDB`)

### Task A1: Create johnmclear/ueberDB fork and clone it

**Files:** none (git/gh only)

- [ ] **Step 1: Create the fork on GitHub**

Run:
```bash
gh repo fork ether/ueberDB --clone=false --default-branch-only
```
Expected: `✓ Created fork johnmclear/ueberDB`.

If it already exists the command prints `johnmclear/ueberDB already exists` — that is fine, continue.

- [ ] **Step 2: Clone the fork locally**

Run:
```bash
git clone https://github.com/johnmclear/ueberDB.git /home/jose/etherpad/ueberDB
cd /home/jose/etherpad/ueberDB
git remote add upstream https://github.com/ether/ueberDB.git
git fetch upstream
```
Expected: clone succeeds, `git remote -v` shows both `origin` (johnmclear) and `upstream` (ether).

- [ ] **Step 3: Identify default branch and sync**

Run:
```bash
git -C /home/jose/etherpad/ueberDB remote show upstream | grep 'HEAD branch'
```
Expected: prints either `HEAD branch: develop` or `HEAD branch: main`. Record the name — subsequent steps refer to it as `<default>`.

Run:
```bash
git -C /home/jose/etherpad/ueberDB checkout <default>
git -C /home/jose/etherpad/ueberDB pull upstream <default>
git -C /home/jose/etherpad/ueberDB push origin <default>
```
Expected: fork's default branch now matches upstream.

- [ ] **Step 4: Create feature branch**

Run:
```bash
git -C /home/jose/etherpad/ueberDB checkout -b fix/bundle-driver-deps
```
Expected: switched to a new branch.

---

### Task A2: Confirm the baseline (existing tests green)

**Files:** none — read-only validation

- [ ] **Step 1: Install deps**

Run:
```bash
cd /home/jose/etherpad/ueberDB && pnpm install
```
Expected: install succeeds, no unusual errors.

- [ ] **Step 2: Run type check and lint**

Run:
```bash
pnpm run ts-check && pnpm run lint
```
Expected: both pass with exit 0.

- [ ] **Step 3: Skip the full driver test suite**

Do **not** run `pnpm test` here — it uses testcontainers and spins up every database, which is slow and requires Docker. CI will run it. If Docker is available and the engineer wants to sanity-run it:
```bash
pnpm test
```
Expected: all driver suites pass.

---

### Task A3: Move drivers from optional peer deps to dependencies

**Files:**
- Modify: `/home/jose/etherpad/ueberDB/package.json`

- [ ] **Step 1: Read current package.json**

Open `/home/jose/etherpad/ueberDB/package.json`. Locate the three relevant blocks: `dependencies`, `peerDependencies`, `peerDependenciesMeta`. Current state (as of 5.0.45):

```json
"dependencies": {
  "async": "^3.2.6",
  "dirty-ts": "^1.1.8",
  "rusty-store-kv": "^1.3.1",
  "simple-git": "^3.36.0"
},
"peerDependencies": {
  "@elastic/elasticsearch": "^9.3.4",
  "cassandra-driver": "^4.8.0",
  "mongodb": "^7.1.1",
  "mssql": "^12.2.1",
  "mysql2": "^3.22.0",
  "nano": "^11.0.5",
  "pg": "^8.20.0",
  "redis": "^5.12.1",
  "rethinkdb": "^2.4.2",
  "surrealdb": "^2.0.3"
},
"peerDependenciesMeta": {
  "@elastic/elasticsearch": {"optional": true},
  "cassandra-driver": {"optional": true},
  "mongodb": {"optional": true},
  "mssql": {"optional": true},
  "mysql2": {"optional": true},
  "nano": {"optional": true},
  "pg": {"optional": true},
  "redis": {"optional": true},
  "rethinkdb": {"optional": true},
  "surrealdb": {"optional": true}
},
```

- [ ] **Step 2: Rewrite the three blocks**

Replace the three blocks with:

```json
"dependencies": {
  "@elastic/elasticsearch": "^9.3.4",
  "async": "^3.2.6",
  "cassandra-driver": "^4.8.0",
  "dirty-ts": "^1.1.8",
  "mongodb": "^7.1.1",
  "mssql": "^12.2.1",
  "mysql2": "^3.22.0",
  "nano": "^11.0.5",
  "pg": "^8.20.0",
  "redis": "^5.12.1",
  "rethinkdb": "^2.4.2",
  "rusty-store-kv": "^1.3.1",
  "simple-git": "^3.36.0",
  "surrealdb": "^2.0.3"
},
```

Delete the `peerDependencies` and `peerDependenciesMeta` blocks entirely.

Keys must be alphabetically sorted in the merged `dependencies` block (matches existing convention).

- [ ] **Step 3: Bump version**

In the same file, change `"version": "5.0.45"` to `"version": "5.0.46"`.

- [ ] **Step 4: Regenerate lockfile**

Run:
```bash
cd /home/jose/etherpad/ueberDB && pnpm install
```
Expected: `pnpm-lock.yaml` updates. No errors. No warnings about missing peer deps (since there are now none).

- [ ] **Step 5: Re-run ts-check and lint**

Run:
```bash
pnpm run ts-check && pnpm run lint
```
Expected: exit 0.

- [ ] **Step 6: Verify drivers now resolve in a fresh node_modules**

Run:
```bash
cd /tmp && rm -rf uberdb-smoke && mkdir uberdb-smoke && cd uberdb-smoke
npm init -y >/dev/null
npm install file:/home/jose/etherpad/ueberDB 2>&1 | tail -3
node -e "
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
Expected: prints `ok` ten times, exits 0.

This is the direct repro test for the issue.

---

### Task A4: Commit and push upstream fix

**Files:**
- Stage: `/home/jose/etherpad/ueberDB/package.json`, `/home/jose/etherpad/ueberDB/pnpm-lock.yaml`

- [ ] **Step 1: Review staged diff**

Run:
```bash
cd /home/jose/etherpad/ueberDB
git diff package.json
git status
```
Expected: only `package.json` and `pnpm-lock.yaml` modified. Confirm the diff matches Task A3.

- [ ] **Step 2: Commit**

Run:
```bash
git add package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
fix: bundle DB drivers as dependencies (restore pre-5.0.45 behavior)

Moves the ten DB drivers back from optional peerDependencies to
dependencies so consumers (notably Etherpad Docker production images)
get them installed automatically.

Fixes Etherpad issue ether/etherpad-lite#7570:
"Cannot find module 'mysql2'" at startup when pnpm production install
skips optional peer deps.
EOF
)"
```
Expected: one commit created on `fix/bundle-driver-deps`.

- [ ] **Step 3: Push to fork**

Run:
```bash
git push -u origin fix/bundle-driver-deps
```
Expected: branch pushed to `johnmclear/ueberDB`.

---

### Task A5: Open upstream PR

**Files:** none

- [ ] **Step 1: Create PR**

Run:
```bash
gh pr create \
  --repo ether/ueberDB \
  --base <default> \
  --head johnmclear:fix/bundle-driver-deps \
  --title "fix: bundle DB drivers as dependencies (fix Etherpad #7570)" \
  --body "$(cat <<'EOF'
## Summary
- Moves all ten DB drivers (`@elastic/elasticsearch`, `cassandra-driver`, `mongodb`, `mssql`, `mysql2`, `nano`, `pg`, `redis`, `rethinkdb`, `surrealdb`) from `peerDependencies` + `peerDependenciesMeta.optional` back to `dependencies`.
- Deletes `peerDependenciesMeta`.
- Bumps version to 5.0.46.

## Why
`ueberdb2@5.0.45` declared the drivers as optional peer deps. Production installs (e.g., `pnpm install --prod`) skip optional peer deps, so consumers hit `Error: Cannot find module 'mysql2'` at first `require` of a driver.

Reported against Etherpad Docker: https://github.com/ether/etherpad-lite/issues/7570

## Test plan
- [ ] CI green (vitest + testcontainers exercises every driver)
- [ ] Local smoke: `npm install ueberdb2@next` into a fresh project, then `require()` each of the ten driver modules — all resolve
EOF
)"
```
Replace `<default>` with whatever Task A1 step 3 recorded (`develop` or `main`).

Expected: PR URL printed.

- [ ] **Step 2: Record PR URL**

Note the PR URL — downstream task (closing #7571) references it.

---

### Task A6: Await merge + publish to npm

**Files:** none — gating task

- [ ] **Step 1: Merge upstream PR**

Once review passes on the PR opened in Task A5, merge it. Then:

```bash
cd /home/jose/etherpad/ueberDB
git checkout <default>
git pull upstream <default>
```
Expected: local default branch is at the merge commit.

- [ ] **Step 2: Publish to npm**

Run the project's existing release workflow. Typically:
```bash
cd /home/jose/etherpad/ueberDB
npm publish
```
(Or trigger the CI publish workflow if one exists — check `.github/workflows/` first.)

Expected: `ueberdb2@5.0.46` is live on npm. Verify:
```bash
npm view ueberdb2 version
```
Expected output: `5.0.46`.

**Do not start Phase B until this step completes** — downstream `pnpm install` must be able to resolve `ueberdb2@^5.0.46` from the public registry.

---

## Phase B — Downstream (`ether/etherpad-lite`)

### Task B1: Close Copilot's PR #7571

**Files:** none — GitHub issue action

- [ ] **Step 1: Comment and close**

Run:
```bash
gh pr close 7571 \
  --repo ether/etherpad-lite \
  --comment "Superseded by the upstream ueberdb2 fix (<Task A5 PR URL>) plus a clean downstream replacement PR incoming on branch \`fix/issue-7570-ueberdb2-drivers\`. See design spec: docs/superpowers/specs/2026-04-20-issue-7570-ueberdb2-drivers-design.md."
```
Expected: PR #7571 closed with comment.

---

### Task B2: Reproduce the bug locally (baseline)

**Files:** none — validation

- [ ] **Step 1: Confirm we are on the feature branch**

Run:
```bash
cd /home/jose/etherpad/etherpad-lite
git status
```
Expected: `On branch fix/issue-7570-ueberdb2-drivers`.

- [ ] **Step 2: Build current Docker production image**

Run:
```bash
cd /home/jose/etherpad/etherpad-lite
docker build --target production -t etherpad:pre-fix .
```
Expected: build succeeds.

- [ ] **Step 3: Demonstrate the missing module**

Run:
```bash
docker run --rm etherpad:pre-fix node -e "try { require('mysql2'); console.log('HAS mysql2'); } catch(e) { console.log('MISSING mysql2:', e.message); }"
```
Expected output: `MISSING mysql2: Cannot find module 'mysql2'`.

This confirms the bug reproduces in the current prod image. Keep this evidence — the same command run in Task B5 Step 3 against the fixed image should print `HAS mysql2`.

---

### Task B3: Bump ueberdb2 and add drivers to `src/package.json`

**Files:**
- Modify: `/home/jose/etherpad/etherpad-lite/src/package.json`

- [ ] **Step 1: Read current dependencies block**

Open `/home/jose/etherpad/etherpad-lite/src/package.json`. Locate the `dependencies` object.

- [ ] **Step 2: Add ten driver entries, keep alphabetical order, bump ueberdb2**

Within `dependencies`, add these keys (inserted in alphabetical position; do not touch any other key):

```json
"@elastic/elasticsearch": "^9.3.4",
"cassandra-driver": "^4.8.0",
"mongodb": "^7.1.1",
"mssql": "^12.2.1",
"mysql2": "^3.22.0",
"nano": "^11.0.5",
"pg": "^8.20.0",
"redis": "^5.12.1",
"rethinkdb": "^2.4.2",
"surrealdb": "^2.0.3",
```

And change the existing `ueberdb2` entry from its current value to:
```json
"ueberdb2": "^5.0.46",
```

**Do not touch** any other dependency, devDependency, script, or metadata field. Specifically the following must remain unchanged vs `origin/develop`:
- `typescript`, `oidc-provider`, `eslint-config-etherpad`, `@types/express-session`, `resolve` versions
- `repository.url`
- `test-admin` npm script and its project list
- Every other field.

- [ ] **Step 3: Verify diff is minimal**

Run:
```bash
cd /home/jose/etherpad/etherpad-lite
git diff src/package.json
```
Expected: exactly 11 lines added (10 new drivers + no other lines) and exactly 1 line modified (the `ueberdb2` version bump). If anything else shows up, revert it.

---

### Task B4: Regenerate `pnpm-lock.yaml`

**Files:**
- Modify: `/home/jose/etherpad/etherpad-lite/pnpm-lock.yaml`

- [ ] **Step 1: Install**

Run:
```bash
cd /home/jose/etherpad/etherpad-lite/src
pnpm install
```
Expected: install succeeds, resolves `ueberdb2@5.0.46` plus the ten drivers. No missing-peer-dep warnings.

- [ ] **Step 2: Sanity-check lockfile scope**

Run:
```bash
cd /home/jose/etherpad/etherpad-lite
git diff --stat pnpm-lock.yaml
```
Expected: only `pnpm-lock.yaml` modified. No unrelated `package.json` files touched.

---

### Task B5: Verify fix locally

**Files:** none — validation

- [ ] **Step 1: Rebuild Docker production image with the fix**

Run:
```bash
cd /home/jose/etherpad/etherpad-lite
docker build --target production -t etherpad:post-fix .
```
Expected: build succeeds.

- [ ] **Step 2: Presence test — all ten drivers resolve**

Run:
```bash
docker run --rm etherpad:post-fix node -e "
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
Expected output: ten lines starting with `ok `, exit code 0.

- [ ] **Step 3: MySQL end-to-end repro (exact issue reporter scenario)**

Create `/tmp/et7570-compose.yml`:
```yaml
services:
  app:
    image: etherpad:post-fix
    depends_on:
      - mariadb
    environment:
      NODE_ENV: production
      ADMIN_PASSWORD: admin
      DB_CHARSET: utf8mb4
      DB_HOST: mariadb
      DB_NAME: etherpad
      DB_PASS: password
      DB_PORT: 3306
      DB_TYPE: mysql
      DB_USER: user
      DEFAULT_PAD_TEXT: "Test "
      TRUST_PROXY: "true"
    ports:
      - "9001:9001"
  mariadb:
    image: mariadb:11.4
    environment:
      MYSQL_DATABASE: etherpad
      MYSQL_USER: user
      MYSQL_PASSWORD: password
      MYSQL_ROOT_PASSWORD: root
      MARIADB_AUTO_UPGRADE: 1
```

Run:
```bash
docker compose -f /tmp/et7570-compose.yml up -d
sleep 30
curl -sf http://localhost:9001/ >/dev/null && echo "OK: Etherpad serves / over MySQL"
docker compose -f /tmp/et7570-compose.yml logs app | grep -c "Cannot find module 'mysql2'" || true
docker compose -f /tmp/et7570-compose.yml down -v
```
Expected: `OK: Etherpad serves / over MySQL`, and the grep count is `0`.

If `curl` fails, inspect `docker compose logs app` — startup may just be slow on the first run; wait 30 more seconds and retry `curl`. If the missing-module error still appears, Task B3/B4 were not applied cleanly.

---

### Task B6: Add the `build-test-db-drivers` CI job

**Files:**
- Modify: `/home/jose/etherpad/etherpad-lite/.github/workflows/docker.yml`

- [ ] **Step 1: Read the current workflow end-to-end**

Open `/home/jose/etherpad/etherpad-lite/.github/workflows/docker.yml` and identify:
- The `jobs:` key and the existing job(s) under it (likely `docker` and/or `publish` after PR #7569).
- The value of `env.TEST_TAG` (expected: `etherpad/etherpad:test`).
- Any `needs:` on a `publish` job.

Do not restructure existing jobs. Only append the new job and extend `needs:`.

- [ ] **Step 2: Append the new job**

Append the following job under `jobs:` (same indentation as existing jobs), placed after the existing `build-test` / `docker` job:

```yaml
  build-test-db-drivers:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    services:
      mysql:
        image: mysql:8
        env:
          MYSQL_ROOT_PASSWORD: password
          MYSQL_DATABASE: etherpad
          MYSQL_USER: etherpad
          MYSQL_PASSWORD: password
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping -h 127.0.0.1 -uroot -ppassword"
          --health-interval=5s
          --health-timeout=5s
          --health-retries=20
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: etherpad
          POSTGRES_USER: etherpad
          POSTGRES_PASSWORD: password
        ports:
          - 5432:5432
        options: >-
          --health-cmd="pg_isready -U etherpad -d etherpad"
          --health-interval=5s
          --health-timeout=5s
          --health-retries=20
    steps:
      - name: Check out
        uses: actions/checkout@v6
        with:
          path: etherpad
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4
      - name: Build production image
        uses: docker/build-push-action@v7
        with:
          context: ./etherpad
          target: production
          load: true
          tags: ${{ env.TEST_TAG }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Driver presence test (all 10 drivers must resolve)
        run: |
          docker run --rm "$TEST_TAG" node -e "
            const mods = [
              '@elastic/elasticsearch','cassandra-driver','mongodb','mssql',
              'mysql2','nano','pg','redis','rethinkdb','surrealdb'
            ];
            let fail = false;
            for (const m of mods) {
              try { require(m); console.log('ok', m); }
              catch (e) { console.error('MISSING', m, e.message); fail = true; }
            }
            if (fail) process.exit(1);
          "
      - name: MySQL smoke — start Etherpad against mysql service
        run: |
          docker run --rm -d \
            --network host \
            -e NODE_ENV=production \
            -e ADMIN_PASSWORD=admin \
            -e DB_TYPE=mysql \
            -e DB_HOST=127.0.0.1 \
            -e DB_PORT=3306 \
            -e DB_NAME=etherpad \
            -e DB_USER=etherpad \
            -e DB_PASS=password \
            -e DB_CHARSET=utf8mb4 \
            -e DEFAULT_PAD_TEXT="Test " \
            --name et-mysql "$TEST_TAG"
          for i in $(seq 1 60); do
            if curl -sf http://127.0.0.1:9001/ >/dev/null; then
              echo "mysql smoke: Etherpad is serving /"
              docker rm -f et-mysql
              exit 0
            fi
            sleep 2
          done
          echo "mysql smoke: timed out waiting for Etherpad"
          docker logs et-mysql || true
          docker rm -f et-mysql || true
          exit 1
      - name: Postgres smoke — start Etherpad against postgres service
        run: |
          docker run --rm -d \
            --network host \
            -e NODE_ENV=production \
            -e ADMIN_PASSWORD=admin \
            -e DB_TYPE=postgres \
            -e DB_HOST=127.0.0.1 \
            -e DB_PORT=5432 \
            -e DB_NAME=etherpad \
            -e DB_USER=etherpad \
            -e DB_PASS=password \
            -e DEFAULT_PAD_TEXT="Test " \
            --name et-postgres "$TEST_TAG"
          for i in $(seq 1 60); do
            if curl -sf http://127.0.0.1:9001/ >/dev/null; then
              echo "postgres smoke: Etherpad is serving /"
              docker rm -f et-postgres
              exit 0
            fi
            sleep 2
          done
          echo "postgres smoke: timed out waiting for Etherpad"
          docker logs et-postgres || true
          docker rm -f et-postgres || true
          exit 1
```

Notes:
- `$TEST_TAG` comes from workflow-level `env.TEST_TAG` — no need to redeclare.
- Port 9001 is Etherpad's default bind port; `--network host` lets us hit the service containers directly.
- Stage order (presence → mysql → postgres) means the fastest, clearest failure mode runs first.

- [ ] **Step 3: Extend `publish` job's `needs:` to gate on this new job**

Locate the `publish` job (added in PR #7569). Its `needs:` currently looks like either:
```yaml
needs: build-test
```
or
```yaml
needs: [build-test]
```

Change to:
```yaml
needs: [build-test, build-test-db-drivers]
```

If no `publish` job exists yet (shouldn't happen post-#7569), the existing job that pushes images (probably containing `docker/login-action`) is the one to gate. Apply the same change to its `needs:`.

- [ ] **Step 4: Lint the YAML**

Run:
```bash
cd /home/jose/etherpad/etherpad-lite
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/docker.yml'))"
```
Expected: exit 0, no output.

- [ ] **Step 5: Confirm no unrelated changes to `docker.yml`**

Run:
```bash
git diff .github/workflows/docker.yml | head -50
git diff --stat .github/workflows/docker.yml
```
Expected: only additions (the new job + the `needs:` change). No other lines modified.

---

### Task B7: Commit and push downstream fix

**Files:**
- Stage: `src/package.json`, `pnpm-lock.yaml`, `.github/workflows/docker.yml`

- [ ] **Step 1: Verify final diff scope**

Run:
```bash
cd /home/jose/etherpad/etherpad-lite
git status
git diff --stat
```
Expected (modified files only):
```
.github/workflows/docker.yml   | 90+ additions
pnpm-lock.yaml                 | large change
src/package.json               | 11 additions, 1 change
```
The spec commit from earlier (branch `fix/issue-7570-ueberdb2-drivers`) is already present from previous work — `git log --oneline` should show it as the tip.

- [ ] **Step 2: Commit**

Run:
```bash
cd /home/jose/etherpad/etherpad-lite
git add src/package.json pnpm-lock.yaml .github/workflows/docker.yml
git commit -m "$(cat <<'EOF'
fix(#7570): bundle DB drivers, add regression CI

- Bump ueberdb2 to ^5.0.46 (upstream now re-bundles drivers).
- Declare all 10 ueberdb2 DB drivers as direct src dependencies as a
  defensive safety net against a future upstream drift.
- Add build-test-db-drivers CI job that blocks the publish job:
    * all-10-drivers presence check in the built prod image
    * end-to-end MySQL smoke (reproduces #7570)
    * end-to-end Postgres smoke
  Any stage failure blocks Docker Hub / GHCR publish.
EOF
)"
```
Expected: one commit on `fix/issue-7570-ueberdb2-drivers`.

- [ ] **Step 3: Add johnmclear fork remote if needed**

Run:
```bash
cd /home/jose/etherpad/etherpad-lite
git remote -v | grep -q '^fork' || git remote add fork https://github.com/johnmclear/etherpad-lite.git
```
Expected: `fork` remote exists.

- [ ] **Step 4: Push branch to fork**

Run:
```bash
git push -u fork fix/issue-7570-ueberdb2-drivers
```
Expected: branch pushed to `johnmclear/etherpad-lite`.

---

### Task B8: Open downstream PR

**Files:** none

- [ ] **Step 1: Create PR**

Run:
```bash
gh pr create \
  --repo ether/etherpad-lite \
  --base develop \
  --head johnmclear:fix/issue-7570-ueberdb2-drivers \
  --title "fix(#7570): bundle DB drivers, add regression CI" \
  --body "$(cat <<'EOF'
## Summary
- Bumps `ueberdb2` to `^5.0.46` — upstream PR `<Task A5 PR URL>` restored drivers as real dependencies.
- Declares all 10 ueberdb2 DB drivers as direct `src/package.json` dependencies as a defensive safety net against any future upstream drift.
- Adds a new `build-test-db-drivers` CI job that blocks `publish`:
  - presence test for all 10 drivers in the built production image
  - MySQL service-container smoke (reproduces #7570)
  - Postgres service-container smoke
- Supersedes #7571 (which mixed scope).

## Test plan
- [ ] `build-test` passes on this PR (existing coverage)
- [ ] `build-test-db-drivers` passes — specifically the MySQL stage is the live reproduction of #7570
- [ ] Local: `docker compose up` with reporter's MySQL config reaches healthy and serves `/`
EOF
)"
```

Expected: PR URL printed. Record it.

---

### Task B9: Verify downstream CI is green

**Files:** none — validation + iteration

- [ ] **Step 1: Watch CI**

Run:
```bash
gh pr checks <PR number from B8> --repo ether/etherpad-lite --watch
```
Expected: all checks green. The two critical ones:
- `build-test` (pre-existing)
- `build-test-db-drivers` (new, with its four stages)

- [ ] **Step 2: If a stage fails, read the logs and fix**

Run:
```bash
gh run view --log-failed --repo ether/etherpad-lite
```
Common failure modes and fixes:
- **Presence test fails for a specific module** → `src/package.json` missing that driver. Re-check Task B3.
- **MySQL smoke times out** → increase retry loop from 60 to 90 iterations, or increase `--health-retries` on the service, and push again. Do not skip the stage.
- **Postgres smoke times out** → same pattern.
- **YAML parse error** → re-run Task B6 Step 4 locally, fix, force-push.

Iterate until green. Per project rule, update PR title/description after every push and post `/review` as a comment to trigger Qodo re-review.

- [ ] **Step 3: Hand off for human review**

Once CI is green, notify the user the PR is ready for review. No further automated action.

---

## Self-review

**Spec coverage:**
- Upstream ueberdb2 driver move → Tasks A1–A6
- Downstream `ueberdb2` bump + driver safety-net list → B3, B4
- Close #7571 → B1
- CI job (presence + MySQL + Postgres, gating publish) → B6
- No unrelated bumps → explicit guard in B3 Step 2 + B7 Step 1 diff check
- Local verification matches spec's "Local verification before pushing" → B5 Steps 1–3
- Rollout order matches spec → Phase A gates Phase B via A6
- Commit targets use johnmclear fork → A1 for upstream, B7 Step 3 for downstream

**Placeholders:** One deliberate placeholder remains (`<default>` for ueberDB's default branch name in A1/A4/A5, and `<Task A5 PR URL>` referenced from B1/B8). These are values the engineer fills in once observed from `gh`/`git`; they are not "TBD implementation details."

**Consistency:** `build-test-db-drivers` job name used identically in B6, B7 commit message, and B8 PR body. Driver list of ten appears identically in A3, B3, B5, and B6. Version `5.0.46` used consistently across A3, A5, A6, B3.
