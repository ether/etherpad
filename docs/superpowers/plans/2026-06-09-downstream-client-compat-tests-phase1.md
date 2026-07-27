# Downstream Client Compatibility Tests — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a core-side compatibility gate (golden-vector + socket-sequence + HTTP-API-shape contract tests, plus a downstream-smoke workflow scaffold) so a PR against `develop` detects changes that would break the separate downstream clients.

**Architecture:** Layer A — hermetic contract tests run inside core's existing mocha backend suite, anchored to a committed `wire-vectors.json` fixture generated from core's own `Changeset`/`AttributePool`. Layer B — a `downstream-smoke.yml` workflow that boots a real Etherpad on :9003, proves the boot→healthcheck→teardown cycle with a self-check, and is ready to matrix over a `clients.json` manifest as clients register in Phase 2.

**Tech Stack:** TypeScript, mocha (`--import=tsx`), `assert/strict`, supertest + socket.io-client via `common.ts` helpers, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-09-downstream-client-compat-tests-design.md`

**Scope note:** This plan is **Phase 1 only** (all changes in `ether/etherpad`). Phase 2 (wiring each client repo's `test:vectors` + smoke and registering it in the manifest) is one separate plan/PR per client repo and is out of scope here.

---

## File Structure

- Create `src/tests/backend/specs/downstream/generate-vectors.ts` — pure module exporting `generateVectors(): WireVector[]`; the single source of truth for the canonical wire fixtures. Also runnable as a CLI to (re)write the fixture.
- Create `src/tests/fixtures/wire-vectors.json` — committed canonical fixture (generated, never hand-edited).
- Create `src/tests/backend/specs/downstream/wire-vectors.ts` — mocha spec asserting the committed fixture is stable and self-consistent.
- Create `src/tests/backend/specs/downstream/wire-socket-sequence.ts` — mocha spec asserting the socket.io handshake + USER_CHANGES→ACCEPT_COMMIT sequence/shapes.
- Create `src/tests/backend/specs/downstream/wire-http-api.ts` — mocha spec snapshotting client-facing HTTP API response shapes.
- Create `src/tests/downstream/clients.json` — manifest of downstream clients (data; entries `enabled:false` until their Phase-2 smoke lands).
- Create `.github/workflows/downstream-smoke.yml` — boot/healthcheck/self-check/teardown + manifest matrix scaffold.
- Modify `src/package.json` — add `vectors:gen` script.

All backend specs live under `specs/downstream/` so the existing `mocha ... --recursive tests/backend/specs` glob picks them up with zero config change.

---

## Task 1: Golden-vector generator module

**Files:**
- Create: `src/tests/backend/specs/downstream/generate-vectors.ts`
- Test: `src/tests/backend/specs/downstream/wire-vectors.ts` (created in Task 3; this task is tested via Task 2's run)

- [ ] **Step 1: Write the generator module**

Create `src/tests/backend/specs/downstream/generate-vectors.ts`:

```typescript
'use strict';

/**
 * Single source of truth for the downstream wire-compatibility fixtures.
 *
 * Each vector is a self-contained changeset application: given `initialAText`
 * and `pool`, applying `changeset` yields `resultAText`. Downstream clients
 * (which reimplement Etherpad's changeset/attribpool decoders) consume the
 * exact same JSON and must reproduce `resultAText`. See the Phase 1 plan.
 *
 * Runnable as a CLI to (re)write src/tests/fixtures/wire-vectors.json:
 *   pnpm run vectors:gen
 */

import Changeset from '../../../../static/js/Changeset';
import AttributePool from '../../../../static/js/AttributePool';

export type WireVector = {
  name: string;
  initialText: string;
  changeset: string;
  pool: ReturnType<AttributePool['toJsonable']>;
  resultText: string;
};

const vector = (
  name: string,
  initialText: string,
  build: (pool: AttributePool) => string,
): WireVector => {
  const pool = new AttributePool();
  const changeset = build(pool);
  Changeset.checkRep(changeset);
  return {
    name,
    initialText,
    changeset,
    pool: pool.toJsonable(),
    resultText: Changeset.applyToText(changeset, initialText),
  };
};

export const generateVectors = (): WireVector[] => [
  vector('plain-insert', 'abc\n', () =>
    Changeset.makeSplice('abc\n', 3, 0, 'XYZ')),

  vector('plain-delete', 'abcdef\n', () =>
    Changeset.makeSplice('abcdef\n', 1, 3, '')),

  vector('formatted-insert', 'abc\n', (pool) =>
    Changeset.makeSplice('abc\n', 3, 0, 'bold', [['bold', 'true']], pool)),

  vector('multiline-insert', 'abc\n', () =>
    Changeset.makeSplice('abc\n', 3, 0, 'one\ntwo\n')),

  vector('attrib-reuse', 'abc\n', (pool) => {
    // Two formatted inserts sharing one pool entry exercises pool index reuse.
    const cs1 = Changeset.makeSplice('abc\n', 0, 0, 'A', [['bold', 'true']], pool);
    const mid = Changeset.applyToText(cs1, 'abc\n');
    const cs2 = Changeset.makeSplice(mid, mid.length - 1, 0, 'B', [['bold', 'true']], pool);
    return Changeset.compose(cs1, cs2, pool);
  }),
];

// CLI entry: write the canonical fixture to disk.
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path');
  const out = path.join(__dirname, '../../../fixtures/wire-vectors.json');
  fs.writeFileSync(out, `${JSON.stringify(generateVectors(), null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(`wrote ${out}`);
}
```

- [ ] **Step 2: Add the `vectors:gen` script**

In `src/package.json`, add to `"scripts"` (alongside the existing `test` entry):

```json
"vectors:gen": "tsx tests/backend/specs/downstream/generate-vectors.ts",
```

- [ ] **Step 3: Sanity-run the generator (no fixture committed yet)**

Run from `src/`:
```bash
cd src && pnpm run vectors:gen
```
Expected: prints `wrote .../src/tests/fixtures/wire-vectors.json` and the file exists with 5 vectors. Verify each has non-empty `changeset` and a `resultText` that differs from `initialText`.

- [ ] **Step 4: Commit**

```bash
git add src/tests/backend/specs/downstream/generate-vectors.ts src/package.json
git commit -m "test(downstream): add golden wire-vector generator"
```

---

## Task 2: Commit the generated fixture

**Files:**
- Create: `src/tests/fixtures/wire-vectors.json`

- [ ] **Step 1: Generate the fixture**

Run from `src/`:
```bash
cd src && pnpm run vectors:gen
```
Expected: `src/tests/fixtures/wire-vectors.json` written.

- [ ] **Step 2: Eyeball the fixture**

Open `src/tests/fixtures/wire-vectors.json`. Confirm it is a JSON array of 5 objects, each with keys `name, initialText, changeset, pool, resultText`. The `pool` for `plain-insert`/`plain-delete`/`multiline-insert` has empty `numToAttrib`; `formatted-insert` and `attrib-reuse` contain a `bold,true` entry.

- [ ] **Step 3: Commit**

```bash
git add src/tests/fixtures/wire-vectors.json
git commit -m "test(downstream): add committed golden wire-vectors fixture"
```

---

## Task 3: Fixture stability + self-consistency spec

**Files:**
- Create: `src/tests/backend/specs/downstream/wire-vectors.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/backend/specs/downstream/wire-vectors.ts`:

```typescript
'use strict';

/**
 * Guards the downstream wire-format contract:
 *  - the committed fixture exactly matches a fresh regeneration (any drift is a
 *    deliberate wire change and must be re-generated + reviewed in the same PR), and
 *  - every vector is internally consistent under core's own Changeset engine.
 */

const assert = require('assert').strict;
import fs from 'fs';
import path from 'path';
import Changeset from '../../../../static/js/Changeset';
import {generateVectors} from './generate-vectors';

const fixturePath = path.join(__dirname, '../../../fixtures/wire-vectors.json');

describe(__filename, function () {
  it('committed fixture matches a fresh regeneration', function () {
    const committed = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const fresh = generateVectors();
    assert.deepEqual(committed, fresh,
      'wire-vectors.json is stale — run `pnpm run vectors:gen` and commit the result');
  });

  it('every vector applies to its result under core Changeset', function () {
    for (const v of generateVectors()) {
      Changeset.checkRep(v.changeset);
      assert.equal(Changeset.applyToText(v.changeset, v.initialText), v.resultText,
        `vector ${v.name} result mismatch`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes (fixture already committed)**

Run from `src/`:
```bash
cd src && pnpm exec mocha --import=tsx --timeout 120000 --extension ts tests/backend/specs/downstream/wire-vectors.ts
```
Expected: 2 passing.

- [ ] **Step 3: Prove the guard bites (temporary edit)**

Hand-edit one `resultText` in `src/tests/fixtures/wire-vectors.json`, re-run the command above.
Expected: the "committed fixture matches a fresh regeneration" test FAILS. Then `git checkout src/tests/fixtures/wire-vectors.json` to restore.

- [ ] **Step 4: Commit**

```bash
git add src/tests/backend/specs/downstream/wire-vectors.ts
git commit -m "test(downstream): assert wire-vectors fixture stability + consistency"
```

---

## Task 4: Socket message-sequence spec

**Files:**
- Create: `src/tests/backend/specs/downstream/wire-socket-sequence.ts`

Reference for helpers: `src/tests/backend/specs/messages.ts` (`common.connect`, `common.handshake`) and `src/tests/backend/common.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/tests/backend/specs/downstream/wire-socket-sequence.ts`:

```typescript
'use strict';

/**
 * Pins the socket.io message sequence + shapes that every realtime client
 * depends on: handshake -> CLIENT_VARS, then USER_CHANGES -> ACCEPT_COMMIT.
 * A change here is a wire-protocol change that will break downstream clients.
 */

const assert = require('assert').strict;
const common = require('../../common');
const padManager = require('../../../node/db/PadManager');
import AttributePool from '../../../../static/js/AttributePool';
import Changeset from '../../../../static/js/Changeset';

describe(__filename, function () {
  let agent: any;
  let socket: any;
  let padId: string;

  before(async function () { agent = await common.init(); });

  beforeEach(async function () {
    padId = common.randomString();
    const pad = await padManager.getPad(padId, 'init\n');
    await pad.setText('init\n');
    const res = await agent.get(`/p/${padId}`).expect(200);
    socket = await common.connect(res);
  });

  afterEach(async function () {
    if (socket != null) socket.close();
    socket = null;
  });

  it('handshake returns CLIENT_VARS with the client-facing shape', async function () {
    const {type, data} = await common.handshake(socket, padId);
    assert.equal(type, 'CLIENT_VARS');
    assert.ok(data.userId, 'CLIENT_VARS.userId missing');
    assert.ok(data.collab_client_vars, 'collab_client_vars missing');
    assert.equal(typeof data.collab_client_vars.rev, 'number');
    assert.ok(data.collab_client_vars.initialAttributedText, 'initialAttributedText missing');
  });

  it('USER_CHANGES is acknowledged with ACCEPT_COMMIT and a bumped rev', async function () {
    const {data: clientVars} = await common.handshake(socket, padId);
    const rev = clientVars.collab_client_vars.rev;
    const pool = new AttributePool();
    const cs = Changeset.makeSplice('init\n', 4, 0, '-typed', [], pool);

    const accepted = common.waitForSocketEvent(socket, 'message');
    socket.emit('message', {
      type: 'COLLABROOM',
      component: 'pad',
      data: {type: 'USER_CHANGES', baseRev: rev, changeset: cs, apool: pool.toJsonable()},
    });
    const msg: any = await accepted;
    assert.equal(msg.type, 'COLLABROOM');
    assert.equal(msg.data.type, 'ACCEPT_COMMIT');
    assert.equal(msg.data.newRev, rev + 1);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run from `src/`:
```bash
cd src && pnpm exec mocha --import=tsx --timeout 120000 --extension ts tests/backend/specs/downstream/wire-socket-sequence.ts
```
Expected: 2 passing. If `waitForSocketEvent`'s default 1s timeout is too tight on the ACCEPT_COMMIT, pass a larger `timeoutMs` (its 3rd arg) — e.g. `common.waitForSocketEvent(socket, 'message', 5000)`.

- [ ] **Step 3: Commit**

```bash
git add src/tests/backend/specs/downstream/wire-socket-sequence.ts
git commit -m "test(downstream): pin socket.io handshake + USER_CHANGES sequence"
```

---

## Task 5: HTTP API shape spec

**Files:**
- Create: `src/tests/backend/specs/downstream/wire-http-api.ts`

Reference: `src/tests/backend/specs/api/api.ts` for the `common.init()` agent + API-version pattern.

- [ ] **Step 1: Write the failing test**

Create `src/tests/backend/specs/downstream/wire-http-api.ts`:

```typescript
'use strict';

/**
 * Snapshots the *shapes* (keys/types, not volatile values) of the HTTP API
 * endpoints downstream clients call to create pads and round-trip text.
 */

const assert = require('assert').strict;
const common = require('../../common');

describe(__filename, function () {
  let agent: any;
  let apiVersion = 1;
  const apiKey = common.apiKey;
  const padId = common.randomString();
  const ep = (point: string, qs: string) =>
    `/api/${apiVersion}/${point}?apikey=${apiKey}&${qs}`;

  before(async function () {
    agent = await common.init();
    const res = await agent.get('/api/').expect(200);
    apiVersion = res.body.currentVersion;
  });

  it('createPad returns the standard {code,message,data} envelope', async function () {
    const res = await agent.get(ep('createPad', `padID=${padId}&text=hello%0A`)).expect(200);
    assert.deepEqual(Object.keys(res.body).sort(), ['code', 'data', 'message']);
    assert.equal(res.body.code, 0);
  });

  it('setText + getText round-trips text through the documented shape', async function () {
    await agent.get(ep('setText', `padID=${padId}&text=world%0A`)).expect(200);
    const res = await agent.get(ep('getText', `padID=${padId}`)).expect(200);
    assert.equal(res.body.code, 0);
    assert.equal(typeof res.body.data.text, 'string');
    assert.equal(res.body.data.text, 'world\n');
  });

  it('getRevisionsCount exposes a numeric revisions field', async function () {
    const res = await agent.get(ep('getRevisionsCount', `padID=${padId}`)).expect(200);
    assert.equal(res.body.code, 0);
    assert.equal(typeof res.body.data.revisions, 'number');
  });
});
```

- [ ] **Step 2: Confirm the apiKey helper name**

Run from `src/`:
```bash
cd src && grep -n "apiKey\|apikey" tests/backend/common.ts | head
```
Expected: a `common.apiKey` export (or similar). If the export is named differently, adjust the `apiKey` reference in the spec to match before running.

- [ ] **Step 3: Run test to verify it passes**

Run from `src/`:
```bash
cd src && pnpm exec mocha --import=tsx --timeout 120000 --extension ts tests/backend/specs/downstream/wire-http-api.ts
```
Expected: 3 passing.

- [ ] **Step 4: Commit**

```bash
git add src/tests/backend/specs/downstream/wire-http-api.ts
git commit -m "test(downstream): snapshot client-facing HTTP API shapes"
```

---

## Task 6: Client manifest

**Files:**
- Create: `src/tests/downstream/clients.json`

- [ ] **Step 1: Write the manifest**

Create `src/tests/downstream/clients.json` (SHAs are current `main` HEADs at authoring; `enabled:false` until each client's Phase-2 smoke lands):

```json
[
  {
    "name": "etherpad-pad",
    "repo": "https://github.com/ether/pad.git",
    "ref": "31176d64ce746d45349e58ee6c0bb043052c6e66",
    "kind": "rust",
    "enabled": false,
    "vectorTest": "cargo test --test vectors",
    "smokeCmd": "cargo test --test smoke -- --ignored"
  },
  {
    "name": "etherpad-cli-client",
    "repo": "https://github.com/ether/etherpad-cli-client.git",
    "ref": "edbe0bb70971e54514ebea672e4ad9b51fc55bff",
    "kind": "node",
    "enabled": false,
    "vectorTest": "pnpm run test:vectors",
    "smokeCmd": "pnpm run test:smoke"
  },
  {
    "name": "etherpad-desktop",
    "repo": "https://github.com/ether/etherpad-desktop.git",
    "ref": "ad273c119f1926a8390c9908fc91f62fa2cf740f",
    "kind": "desktop",
    "enabled": false,
    "vectorTest": "pnpm run test:vectors",
    "smokeCmd": "pnpm run test:smoke"
  }
]
```

- [ ] **Step 2: Validate it is well-formed JSON**

Run:
```bash
node -e "const c=require('./src/tests/downstream/clients.json'); console.log(c.length, c.map(x=>x.name).join(','))"
```
Expected: `3 etherpad-pad,etherpad-cli-client,etherpad-desktop`.

- [ ] **Step 3: Commit**

```bash
git add src/tests/downstream/clients.json
git commit -m "test(downstream): add client manifest (entries disabled pending Phase 2)"
```

---

## Task 7: Downstream-smoke workflow

**Files:**
- Create: `.github/workflows/downstream-smoke.yml`

Reference an existing workflow (`.github/workflows/backend-tests.yml`) for the checkout/pnpm/node setup block this repo uses, and copy that setup verbatim into the job below.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/downstream-smoke.yml`:

```yaml
name: Downstream smoke

on:
  pull_request:
  schedule:
    - cron: '0 4 * * *'   # nightly against develop

permissions:
  contents: read

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - name: Checkout core (PR)
        uses: actions/checkout@v4

      # --- Reuse core's standard node+pnpm setup (copy from backend-tests.yml) ---
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - name: Install deps
        run: pnpm install --frozen-lockfile

      - name: Boot Etherpad on :9003
        env:
          APIKEY: downstream-smoke-key
        run: |
          mkdir -p var
          echo -n "$APIKEY" > APIKEY.txt
          PORT=9003 pnpm run prod &
          echo $! > /tmp/ep.pid

      - name: Wait for healthcheck
        run: |
          for i in $(seq 1 60); do
            if curl -fsS http://localhost:9003/api/ >/dev/null; then
              echo "up"; exit 0
            fi
            sleep 2
          done
          echo "server did not come up"; exit 1

      - name: Self-check (boot + API roundtrip proves the harness)
        run: |
          K=downstream-smoke-key
          curl -fsS "http://localhost:9003/api/1/createPad?apikey=$K&padID=smoke&text=hi%0A"
          curl -fsS "http://localhost:9003/api/1/getText?apikey=$K&padID=smoke" | grep -q '"text":"hi'

      - name: Generate canonical wire-vectors
        run: cd src && pnpm run vectors:gen

      - name: Run enabled downstream clients
        run: |
          node -e '
            const fs=require("fs");
            const clients=require("./src/tests/downstream/clients.json").filter(c=>c.enabled);
            if(!clients.length){console.log("No clients enabled yet (Phase 1).");process.exit(0);}
            fs.writeFileSync("/tmp/clients.json",JSON.stringify(clients));
          '
          # Phase 2 wires per-kind clone + toolchain + vector injection + smoke here,
          # iterating /tmp/clients.json. Until a client is enabled this is a no-op.

      - name: Teardown (by PID, never pkill)
        if: always()
        run: |
          if [ -f /tmp/ep.pid ]; then kill "$(cat /tmp/ep.pid)" 2>/dev/null || true; fi
```

- [ ] **Step 2: Confirm the boot command + port env**

Run:
```bash
cd /home/jose/etherpad/etherpad-core-fresh && grep -nE '"prod"|"dev"|"start"' src/package.json
grep -rn "process.env.PORT\|settings.port" src/node/utils/Settings.ts | head
```
Expected: confirm the script that starts a production server and that `PORT`/`APIKEY` are honored (Settings reads `process.env.PORT`). If the runnable script is named differently (e.g. `prod` vs `dev`), update the "Boot Etherpad" step to match. If APIKEY is read from a file rather than env, the `echo ... > APIKEY.txt` line already covers it.

- [ ] **Step 3: Lint the workflow YAML**

Run:
```bash
node -e "require('js-yaml')" 2>/dev/null && npx --yes js-yaml .github/workflows/downstream-smoke.yml >/dev/null && echo "valid yaml" || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/downstream-smoke.yml')); print('valid yaml')"
```
Expected: `valid yaml`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/downstream-smoke.yml
git commit -m "ci(downstream): add downstream-smoke workflow (boot/self-check/teardown + manifest scaffold)"
```

---

## Task 8: Full backend-suite run + push

**Files:** none (verification + integration)

- [ ] **Step 1: Run the whole downstream spec group**

Per the "always run backend tests" rule, run the new specs through the real mocha invocation the suite uses, from `src/`:
```bash
cd src && cross-env NODE_ENV=production pnpm exec mocha --import=tsx --timeout 120000 --extension ts --recursive tests/backend/specs/downstream
```
Expected: all specs in `tests/backend/specs/downstream/` pass (7 tests total across 3 files).

- [ ] **Step 2: Confirm no regression in the fixture guard**

Run from `src/`:
```bash
cd src && pnpm run vectors:gen && git diff --exit-code src/tests/fixtures/wire-vectors.json
```
Expected: exit 0 (regeneration is byte-identical to the committed fixture).

- [ ] **Step 3: Push the branch and open the PR**

```bash
git push -u origin feat/downstream-client-compat-tests
gh pr create --base develop \
  --title "test: downstream client compatibility gate (Phase 1)" \
  --body "Adds core-side contract tests (golden wire-vectors, socket-sequence, HTTP API shapes) and a downstream-smoke workflow scaffold so PRs detect changes that would break the separate CLI / terminal / desktop clients. Phase 2 wires each client repo's vector+smoke tests and flips its manifest entry to enabled. Spec + plan under docs/superpowers/. Closes nothing; tracks the downstream-compat initiative."
```

- [ ] **Step 4: Watch CI**

Per the "check CI after PRs" rule, wait ~20s then:
```bash
gh pr checks --watch
```
Expected: backend tests green (now including the downstream specs); `Downstream smoke` green (self-check passes, no clients enabled yet). Fix any red before moving on.

---

## Self-Review

**Spec coverage:**
- Layer A golden vectors → Tasks 1–3. ✅
- Layer A socket sequence → Task 4. ✅
- Layer A HTTP API shapes → Task 5. ✅
- Layer B manifest (pinned SHAs, `enabled` gate) → Task 6. ✅
- Layer B workflow (boot :9003, healthcheck, vector generation, PID teardown, nightly+PR triggers) → Task 7. ✅
- Flakiness mitigations: healthcheck-poll (Task 7 step), PID teardown (Task 7), :9003 (Task 7), no external clients on the gate yet so no flake surface (Task 6 `enabled:false`). ✅
- Phasing: Phase 1 self-contained and green; Phase 2 explicitly out of scope. ✅

**Verification-required tasks** (Task 5 step 2, Task 7 step 2) ask the engineer to confirm the exact `common.apiKey` export name and the production boot script/port handling against the live repo before running — these are real lookups, not placeholders, because those names are repo-version-specific.

**Type consistency:** `WireVector` fields (`name/initialText/changeset/pool/resultText`) are defined in Task 1 and used identically in Tasks 2–3. `generateVectors()` signature is stable across Tasks 1/3. Manifest keys (`enabled`, `vectorTest`, `smokeCmd`) in Task 6 match the workflow's `.filter(c=>c.enabled)` consumer in Task 7.
