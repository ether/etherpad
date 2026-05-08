# Auto-Update PR 2 — Tier 2 (Manual Click) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Tier 2 of the four-tier auto-update subsystem: an admin can click "Apply now" on the existing `/admin/update` page, Etherpad drains active sessions for 60s, runs `git fetch / checkout / pnpm install --frozen-lockfile / pnpm run build:ui`, exits 75 for a process supervisor to restart, and on the next boot a health-check timer either marks the update verified or rolls back.

**Architecture:** Build atomic primitives (lock, executor, rollback, drainer) under `src/node/updater/`, expose four admin-only state-changing endpoints (`apply`, `cancel`, `acknowledge`, `log`) plus log-tail streaming, wire RollbackHandler into the boot sequence, and extend the existing `/admin/update` page with an Apply button + log view + terminal-state acknowledgement UI. Every executable step goes through dependency-injected `spawn`/`fetch`/`fs` so we can run the full pipeline in tests against a tmp git repo without mutating the real install.

**Tech Stack:** TypeScript (Node 20+), `child_process.spawn`, `node:fs/promises`, log4js (rolling-file appender), express + supertest (mocha integration), vitest (unit), React + zustand + react-i18next (admin UI), Playwright (admin E2E).

**Spec:** `docs/superpowers/specs/2026-04-25-auto-update-design.md` (sections "Architecture / Components", "API surface / Tier 2 — manual click", "Error handling", "Phased rollout / PR 2").

**Out of scope (deferred):** Tier 3 Scheduler + grace window, Tier 4 MaintenanceWindow, real GPG signature verification (we ship a feature-flagged stub gated by `updates.requireSignature: false`; documented as follow-up).

---

## File Structure

### New files
- `src/node/updater/lock.ts` — PID-based file lock (`var/update.lock`), stale-pid reaper.
- `src/node/updater/trustedKeys.ts` — release-tag signature verification (stubbed unless `requireSignature: true`).
- `src/node/updater/preflight.ts` — pure-ish pre-flight checks (working tree clean, disk space, lock free, install method writable, target tag exists, sig verifies).
- `src/node/updater/UpdateExecutor.ts` — child-process orchestration (snapshot → fetch → checkout → install → build → exit 75). All shell-outs go through an injected `spawnFn`.
- `src/node/updater/RollbackHandler.ts` — boot-time pending-verification check, 60s health timer, crash-loop guard, restore SHA + lockfile + retry install on failure.
- `src/node/updater/SessionDrainer.ts` — broadcasts shoutMessage at T-60/-30/-10, refuses new socket connections via a module flag.
- `src/node/updater/updateLog.ts` — log4js rolling-file appender pointed at `var/log/update.log` (10MB × 5) + `tailLines(n)` helper.
- `src/node/hooks/express/updateActions.ts` — registers `POST /admin/update/{apply,cancel,acknowledge}` and `GET /admin/update/log`. Strict admin auth on all four.
- `src/tests/backend-new/specs/updater/lock.test.ts`
- `src/tests/backend-new/specs/updater/preflight.test.ts`
- `src/tests/backend-new/specs/updater/UpdateExecutor.test.ts`
- `src/tests/backend-new/specs/updater/RollbackHandler.test.ts`
- `src/tests/backend-new/specs/updater/SessionDrainer.test.ts`
- `src/tests/backend-new/specs/updater/updateLog.test.ts`
- `src/tests/backend/specs/updateActions.ts` — mocha integration tests for apply/cancel/acknowledge/log.
- `src/tests/backend/specs/updater-integration.ts` — end-to-end against a tmp git repo (happy path, install-fail rollback, build-fail rollback, health-check timeout, crash-loop forced rollback, terminal `rollback-failed` blocks auto/autonomous but allows manual).
- `src/tests/frontend-new/admin-spec/update-page-actions.spec.ts` — Playwright: Apply button, log stream visibility, terminal-state Acknowledge, refusal when policy denies.
- `doc/admin/updates.md` — extend with Tier 2 docs (Apply flow, settings, supervisor requirement).

### Modified files
- `src/node/updater/types.ts` — extend `UpdateState` with `execution: ExecutionState`, `bootCount: number`, `lastResult`. Add discriminated `ExecutionStatus` union covering all states from the spec's state machine.
- `src/node/updater/state.ts` — extend the `isValid` validator to cover the new fields; backfill defaults during load so state files written by PR 1 still load.
- `src/node/updater/UpdatePolicy.ts` — extend `evaluatePolicy` so `canManual` returns false in `rollback-failed`-equivalent terminal states only when `purpose === 'auto'`; manual remains permitted (admin clicking Apply *is* the intervention). Add `purpose: 'manual' | 'auto'` to the input.
- `src/node/updater/index.ts` — call RollbackHandler.checkPendingVerification at boot before VersionChecker starts; expose getters needed by routes.
- `src/node/utils/Settings.ts` — add `updates.preApplyGraceMinutes` (default 0 in PR 2; tier 3 makes it meaningful), `updates.drainSeconds` (default 60), `updates.rollbackHealthCheckSeconds` (default 60), `updates.diskSpaceMinMB` (default 500), `updates.requireSignature` (default false), `updates.trustedKeysPath` (default null).
- `settings.json.template`, `settings.json.docker` — add the new `updates.*` keys with shipped defaults and a comment block.
- `src/static/js/pad_utils.js` (or the COLLABROOM message handler) — recognise a new `shoutMessage` subtype `update-drain` so the drain notice has its own translatable string and CSS hook (the spec calls this a "system message at T-60/T-30/T-10"; we route it through the existing shout pipeline).
- `src/locales/en.json` — add `update.page.apply`, `update.page.cancel`, `update.page.acknowledge`, `update.page.log`, `update.page.execution`, `update.page.policy.*`, `update.page.last_result.*`, `update.execution.*`, `update.banner.terminal.rollback-failed`, `update.drain.t60`, `update.drain.t30`, `update.drain.t10`.
- `admin/src/store/store.ts` — extend `UpdateStatusPayload` with `execution`, `bootCount`, `lastResult` to match server shape; add `setUpdateLog` slice.
- `admin/src/pages/UpdatePage.tsx` — Apply / Cancel / Acknowledge buttons (gated on `policy.canManual`), polling log view while `execution.status === 'executing' | 'draining'`, terminal-state copy + Acknowledge button.
- `admin/src/components/UpdateBanner.tsx` — surface terminal states (`rollback-failed`, `preflight-failed`, `rolled-back-*`) with stronger copy.
- `CHANGELOG.md` — Unreleased section entry.

---

## Conventions

- **Test runners:** unit specs go under `src/tests/backend-new/specs/updater/*.test.ts` and run with vitest (`pnpm vitest run path/to/file`). Integration/API specs go under `src/tests/backend/specs/*.ts` and run with mocha via `pnpm run test --runInBand` or `pnpm run test -- --grep <name>`.
- **TDD loop:** write the failing test, run it, see the expected failure mode, write the minimum code to pass, run again, commit.
- **Commits:** one per task. Conventional Commits style. The footer used elsewhere on this branch is `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **No new "etherpad-lite" references** — the project is now "etherpad" in user-facing strings, docs, and configs (memory: `feedback_no_etherpad_lite_name`).
- **Always i18n** — never hardcode user-facing English (memory: `feedback_always_i18n`). Use existing keys when possible.
- **Working tree:** before starting, switch to a fresh branch off `develop`. Never push to `develop` or `main` directly (memory: `feedback_no_direct_push`).

---

## Task 0: Branch off develop

**Files:** none (git only).

- [ ] **Step 1: Stash anything dirty, switch to develop, pull, branch off**

```bash
git stash push -u -m "wip-7696-popup-scroll" || true
git fetch origin
git checkout develop
git pull --ff-only origin develop
git checkout -b feat/7607-auto-update-tier2-manual-click
```

Expected: branch `feat/7607-auto-update-tier2-manual-click` based on latest `origin/develop`.

- [ ] **Step 2: Confirm Tier 1 surface still passes**

Run: `pnpm run ts-check && pnpm vitest run src/tests/backend-new/specs/updater`
Expected: PASS (we are baselining before adding code).

---

## Task 1: Extend types + state validator + settings for Tier 2

**Files:**
- Modify: `src/node/updater/types.ts`
- Modify: `src/node/updater/state.ts`
- Modify: `src/node/utils/Settings.ts`
- Modify: `settings.json.template`
- Modify: `settings.json.docker`
- Test: `src/tests/backend-new/specs/updater/state.test.ts` (existing — extend)

- [ ] **Step 1: Add a failing test for the extended state shape**

Append to `src/tests/backend-new/specs/updater/state.test.ts` inside its existing `describe`:

```typescript
import {EMPTY_STATE} from '../../../../node/updater/types';

describe('Tier 2 state extensions', () => {
  it('EMPTY_STATE carries an idle execution block, bootCount 0, no lastResult', () => {
    expect(EMPTY_STATE.execution).toEqual({status: 'idle'});
    expect(EMPTY_STATE.bootCount).toBe(0);
    expect(EMPTY_STATE.lastResult).toBeNull();
  });

  it('loadState backfills missing Tier 2 fields on a Tier 1 file', async () => {
    const tmp = path.join(os.tmpdir(), `state-${Date.now()}.json`);
    await fs.writeFile(tmp, JSON.stringify({
      schemaVersion: 1, lastCheckAt: null, lastEtag: null, latest: null,
      vulnerableBelow: [], email: {severeAt: null, vulnerableAt: null, vulnerableNewReleaseTag: null},
    }));
    const state = await loadState(tmp);
    expect(state.execution).toEqual({status: 'idle'});
    expect(state.bootCount).toBe(0);
    expect(state.lastResult).toBeNull();
    await fs.unlink(tmp);
  });

  it('rejects a malformed execution block by resetting to EMPTY_STATE', async () => {
    const tmp = path.join(os.tmpdir(), `state-${Date.now()}.json`);
    await fs.writeFile(tmp, JSON.stringify({
      schemaVersion: 1, lastCheckAt: null, lastEtag: null, latest: null,
      vulnerableBelow: [], email: {severeAt: null, vulnerableAt: null, vulnerableNewReleaseTag: null},
      execution: 'not-an-object',
    }));
    const state = await loadState(tmp);
    expect(state).toEqual(EMPTY_STATE);
    await fs.unlink(tmp);
  });
});
```

(Add `import os from 'node:os'` and `import fs from 'node:fs/promises'` at the top of the file if not present.)

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/state.test.ts`
Expected: FAIL on `EMPTY_STATE.execution` being undefined.

- [ ] **Step 3: Extend `types.ts`**

Replace the bottom of `src/node/updater/types.ts` (`UpdateState` interface and `EMPTY_STATE`) with:

```typescript
/**
 * Discriminated union mirroring the state machine in
 * docs/superpowers/specs/2026-04-25-auto-update-design.md (section "State machine").
 *
 * Terminal states (`rollback-failed`) require an admin POST to /admin/update/acknowledge
 * before further auto/autonomous attempts are allowed. Manual updates remain permitted
 * because an admin clicking Apply *is* the intervention.
 */
export type ExecutionStatus =
  | {status: 'idle'}
  | {status: 'preflight'; targetTag: string; startedAt: string}
  | {status: 'preflight-failed'; targetTag: string; reason: string; at: string}
  | {status: 'draining'; targetTag: string; drainEndsAt: string; startedAt: string}
  | {status: 'executing'; targetTag: string; fromSha: string; startedAt: string}
  | {status: 'pending-verification'; targetTag: string; fromSha: string; deadlineAt: string}
  | {status: 'verified'; targetTag: string; verifiedAt: string}
  | {status: 'rolling-back'; reason: string; targetTag: string; fromSha: string; at: string}
  | {status: 'rolled-back'; reason: string; targetTag: string; restoredSha: string; at: string}
  | {status: 'rollback-failed'; reason: string; targetTag: string; fromSha: string; at: string};

export type LastUpdateResult = {
  /** Tag we were updating to. */
  targetTag: string;
  /** SHA we were updating from. */
  fromSha: string;
  /** Outcome to surface in admin UI. */
  outcome: 'verified' | 'rolled-back' | 'rollback-failed' | 'preflight-failed' | 'cancelled';
  /** Human-readable reason on non-success. */
  reason: string | null;
  /** ISO timestamp when this result was finalised. */
  at: string;
} | null;

export interface UpdateState {
  schemaVersion: 1;
  lastCheckAt: string | null;
  lastEtag: string | null;
  latest: ReleaseInfo | null;
  vulnerableBelow: VulnerableBelowDirective[];
  email: EmailSendLog;
  /** Current in-flight execution state. Persisted so a restart mid-update reaches RollbackHandler. */
  execution: ExecutionStatus;
  /**
   * Boot counter that the RollbackHandler increments while a `pending-verification`
   * status is live. > 2 means the new version crash-looped; force rollback regardless of timer.
   */
  bootCount: number;
  /** Most recent terminal outcome, surfaced in admin UI even after `execution` returns to idle. */
  lastResult: LastUpdateResult;
}

export const EMPTY_STATE: UpdateState = {
  schemaVersion: 1,
  lastCheckAt: null,
  lastEtag: null,
  latest: null,
  vulnerableBelow: [],
  email: {
    severeAt: null,
    vulnerableAt: null,
    vulnerableNewReleaseTag: null,
  },
  execution: {status: 'idle'},
  bootCount: 0,
  lastResult: null,
};
```

- [ ] **Step 4: Extend `state.ts` validators**

In `src/node/updater/state.ts`, add these helpers above `isValid` and call them from `isValid`:

```typescript
const VALID_STATUSES = new Set([
  'idle', 'preflight', 'preflight-failed', 'draining', 'executing',
  'pending-verification', 'verified', 'rolling-back', 'rolled-back', 'rollback-failed',
]);

const isValidExecution = (v: unknown): boolean => {
  if (!isPlainObject(v)) return false;
  return typeof v.status === 'string' && VALID_STATUSES.has(v.status as string);
};

const isValidLastResult = (v: unknown): boolean => {
  if (v === null) return true;
  if (!isPlainObject(v)) return false;
  return typeof v.targetTag === 'string'
    && typeof v.fromSha === 'string'
    && typeof v.outcome === 'string'
    && (v.reason === null || typeof v.reason === 'string')
    && typeof v.at === 'string';
};
```

Update `isValid` to *backfill* the new fields if missing instead of rejecting (to keep PR 1 state files loadable), and reject only when present-and-malformed:

```typescript
const isValid = (raw: unknown): raw is UpdateState => {
  if (!isPlainObject(raw)) return false;
  if (raw.schemaVersion !== 1) return false;
  if (!isStringOrNull(raw.lastCheckAt)) return false;
  if (!isStringOrNull(raw.lastEtag)) return false;
  if (!isValidLatest(raw.latest)) return false;
  if (!isValidVulnerableBelow(raw.vulnerableBelow)) return false;
  if (!isValidEmail(raw.email)) return false;
  // PR 2 fields: missing → backfill at load time; present-but-wrong → reject.
  if (raw.execution !== undefined && !isValidExecution(raw.execution)) return false;
  if (raw.bootCount !== undefined && typeof raw.bootCount !== 'number') return false;
  if (raw.lastResult !== undefined && !isValidLastResult(raw.lastResult)) return false;
  return true;
};
```

Update `loadState` to splat defaults for the new fields:

```typescript
export const loadState = async (filePath: string): Promise<UpdateState> => {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') return structuredClone(EMPTY_STATE);
    throw err;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return structuredClone(EMPTY_STATE); }
  if (!isValid(parsed)) return structuredClone(EMPTY_STATE);
  // Backfill PR 2 fields on a Tier 1 state file.
  return {
    ...structuredClone(EMPTY_STATE),
    ...(parsed as object),
    execution: (parsed as any).execution ?? structuredClone(EMPTY_STATE.execution),
    bootCount: (parsed as any).bootCount ?? 0,
    lastResult: (parsed as any).lastResult ?? null,
  };
};
```

- [ ] **Step 5: Extend `Settings.ts` typing and defaults**

In the `SettingsType.updates` block (around line 326) add:

```typescript
  preApplyGraceMinutes: number,
  drainSeconds: number,
  rollbackHealthCheckSeconds: number,
  diskSpaceMinMB: number,
  requireSignature: boolean,
  trustedKeysPath: string | null,
```

In the `settings: SettingsType = { ... updates: { ... } ... }` defaults (around line 506) add:

```typescript
    preApplyGraceMinutes: 0,
    drainSeconds: 60,
    rollbackHealthCheckSeconds: 60,
    diskSpaceMinMB: 500,
    requireSignature: false,
    trustedKeysPath: null,
```

Add the same keys to `settings.json.template` and `settings.json.docker` inside their `updates` blocks. Comment in template:

```jsonc
  "updates": {
    "tier": "notify",
    /* ... existing keys ... */
    /* Tier 2+ knobs (only meaningful at tier "manual" or higher) */
    "preApplyGraceMinutes": 0,
    "drainSeconds": 60,
    "rollbackHealthCheckSeconds": 60,
    "diskSpaceMinMB": 500,
    /* When true, refuse updates whose tag is not signed by a trusted key. */
    "requireSignature": false,
    "trustedKeysPath": null
  },
```

- [ ] **Step 6: Run the tests**

```bash
pnpm vitest run src/tests/backend-new/specs/updater/state.test.ts
pnpm run ts-check
```

Expected: state tests PASS, ts-check clean.

- [ ] **Step 7: Commit**

```bash
git add src/node/updater/types.ts src/node/updater/state.ts \
  src/node/utils/Settings.ts settings.json.template settings.json.docker \
  src/tests/backend-new/specs/updater/state.test.ts
git commit -m "$(cat <<'EOF'
feat(updater): extend state + settings for Tier 2 manual-click

Adds ExecutionStatus discriminated union, bootCount, and lastResult to
UpdateState, plus the preApplyGraceMinutes/drainSeconds/diskSpaceMinMB/
requireSignature/trustedKeysPath knobs that Tier 2's executor needs.
loadState backfills the new fields on Tier 1 state files so existing
installs keep working.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: PID-based update lock

**Files:**
- Create: `src/node/updater/lock.ts`
- Test: `src/tests/backend-new/specs/updater/lock.test.ts`

The lock at `var/update.lock` carries the holder's PID. A second acquire reads the file, sends signal 0 to the recorded PID; if the PID is gone (ESRCH) the lock is stale and we reap it.

- [ ] **Step 1: Write failing test**

Create `src/tests/backend-new/specs/updater/lock.test.ts`:

```typescript
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {acquireLock, releaseLock, isHeld} from '../../../../node/updater/lock';

describe('update lock', () => {
  let dir: string;
  let lockPath: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-lock-'));
    lockPath = path.join(dir, 'update.lock');
  });
  afterEach(async () => {
    await fs.rm(dir, {recursive: true, force: true});
  });

  it('acquires and releases', async () => {
    expect(await acquireLock(lockPath)).toBe(true);
    expect(await isHeld(lockPath)).toBe(true);
    await releaseLock(lockPath);
    expect(await isHeld(lockPath)).toBe(false);
  });

  it('rejects a second acquire while live', async () => {
    expect(await acquireLock(lockPath)).toBe(true);
    expect(await acquireLock(lockPath)).toBe(false);
    await releaseLock(lockPath);
  });

  it('reaps a stale lock whose PID is gone', async () => {
    // Write a lock claiming a PID that almost certainly does not exist.
    await fs.writeFile(lockPath, JSON.stringify({pid: 2147483646, at: new Date().toISOString()}));
    expect(await acquireLock(lockPath)).toBe(true);
    await releaseLock(lockPath);
  });

  it('treats an unparseable lock file as stale', async () => {
    await fs.writeFile(lockPath, 'garbage');
    expect(await acquireLock(lockPath)).toBe(true);
    await releaseLock(lockPath);
  });
});
```

- [ ] **Step 2: Run — expect fail (module missing)**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/lock.test.ts`
Expected: FAIL with import error.

- [ ] **Step 3: Implement lock**

Create `src/node/updater/lock.ts`:

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';

interface LockFile {pid: number; at: string}

const isPidLive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // ESRCH = no such process (stale). EPERM = exists but we can't signal — treat as live.
    return err.code !== 'ESRCH';
  }
};

const readIfPresent = async (lockPath: string): Promise<LockFile | null> => {
  let raw: string;
  try { raw = await fs.readFile(lockPath, 'utf8'); }
  catch (err: any) { return err.code === 'ENOENT' ? null : null; }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pid !== 'number' || typeof parsed?.at !== 'string') return null;
    return parsed;
  } catch { return null; }
};

/**
 * Atomic acquire via O_CREAT|O_EXCL. If the file already exists, the holder's PID
 * is checked; if dead, we reap and retry once. Returns false on a live conflict.
 */
export const acquireLock = async (lockPath: string): Promise<boolean> => {
  await fs.mkdir(path.dirname(lockPath), {recursive: true});
  const payload = JSON.stringify({pid: process.pid, at: new Date().toISOString()});
  try {
    const fh = await fs.open(lockPath, 'wx');
    try { await fh.writeFile(payload); } finally { await fh.close(); }
    return true;
  } catch (err: any) {
    if (err.code !== 'EEXIST') throw err;
  }
  const existing = await readIfPresent(lockPath);
  if (existing && isPidLive(existing.pid)) return false;
  // Stale — unlink and retry once. A concurrent reaper may beat us, so EEXIST is also "no".
  try { await fs.unlink(lockPath); } catch (err: any) { if (err.code !== 'ENOENT') throw err; }
  try {
    const fh = await fs.open(lockPath, 'wx');
    try { await fh.writeFile(payload); } finally { await fh.close(); }
    return true;
  } catch (err: any) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
};

export const releaseLock = async (lockPath: string): Promise<void> => {
  try { await fs.unlink(lockPath); }
  catch (err: any) { if (err.code !== 'ENOENT') throw err; }
};

export const isHeld = async (lockPath: string): Promise<boolean> => {
  const f = await readIfPresent(lockPath);
  return !!f && isPidLive(f.pid);
};
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/lock.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/lock.ts src/tests/backend-new/specs/updater/lock.test.ts
git commit -m "$(cat <<'EOF'
feat(updater): PID-based update.lock with stale-pid reaping

Single-flight guard for Tier 2's UpdateExecutor. Atomic O_CREAT|O_EXCL
acquire; on EEXIST, sends signal 0 to the recorded PID and reaps if dead.
Unparseable lock files are treated as stale rather than fatal so a
half-written lock from a SIGKILL'd parent doesn't lock the install out.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Trusted-keys / signature verification stub

**Files:**
- Create: `src/node/updater/trustedKeys.ts`
- Test: `src/tests/backend-new/specs/updater/trustedKeys.test.ts`

We ship a feature-flagged signature verifier. With `updates.requireSignature: false` (default) we log a one-line warning and return `ok`. With `requireSignature: true` we shell out to `git verify-tag <tag>` and require exit 0; the trusted set is whatever keys are imported into the Etherpad user's GnuPG keyring (or a custom keyring at `updates.trustedKeysPath` — passed to git via `GNUPGHOME`). Real key-rotation policy is documented as follow-up; this gives admins who care a working knob today.

- [ ] **Step 1: Failing test**

Create `src/tests/backend-new/specs/updater/trustedKeys.test.ts`:

```typescript
import {describe, it, expect, vi} from 'vitest';
import {verifyReleaseTag} from '../../../../node/updater/trustedKeys';

describe('verifyReleaseTag', () => {
  it('returns ok when requireSignature is false (no spawn)', async () => {
    const spawnFn = vi.fn();
    const r = await verifyReleaseTag({
      tag: 'v2.7.3', repoDir: '/tmp/x', requireSignature: false,
      trustedKeysPath: null, spawnFn: spawnFn as any,
    });
    expect(r).toEqual({ok: true, reason: 'signature-not-required'});
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('returns ok on git verify-tag exit 0', async () => {
    const spawnFn = vi.fn(() => ({on: (e: string, cb: any) => e === 'close' && setTimeout(() => cb(0), 0)}));
    const r = await verifyReleaseTag({
      tag: 'v2.7.3', repoDir: '/tmp/x', requireSignature: true,
      trustedKeysPath: null, spawnFn: spawnFn as any,
    });
    expect(r.ok).toBe(true);
    expect(spawnFn).toHaveBeenCalledWith(
      'git',
      ['verify-tag', 'v2.7.3'],
      expect.objectContaining({cwd: '/tmp/x'}),
    );
  });

  it('returns failure on non-zero exit', async () => {
    const spawnFn = vi.fn(() => ({on: (e: string, cb: any) => e === 'close' && setTimeout(() => cb(1), 0)}));
    const r = await verifyReleaseTag({
      tag: 'v2.7.3', repoDir: '/tmp/x', requireSignature: true,
      trustedKeysPath: null, spawnFn: spawnFn as any,
    });
    expect(r).toEqual({ok: false, reason: 'signature-verification-failed'});
  });

  it('passes GNUPGHOME when trustedKeysPath is set', async () => {
    const calls: any[] = [];
    const spawnFn = vi.fn((cmd: string, args: string[], opts: any) => {
      calls.push({cmd, args, env: opts.env});
      return {on: (e: string, cb: any) => e === 'close' && setTimeout(() => cb(0), 0)} as any;
    });
    await verifyReleaseTag({
      tag: 'v2.7.3', repoDir: '/tmp/x', requireSignature: true,
      trustedKeysPath: '/srv/etherpad/keys', spawnFn: spawnFn as any,
    });
    expect(calls[0].env.GNUPGHOME).toBe('/srv/etherpad/keys');
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/trustedKeys.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/node/updater/trustedKeys.ts`:

```typescript
import {spawn as realSpawn, SpawnOptions} from 'node:child_process';
import log4js from 'log4js';

const logger = log4js.getLogger('updater');

export type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => {
  on: (event: 'close', cb: (code: number | null) => void) => void;
};

export interface VerifyArgs {
  tag: string;
  repoDir: string;
  requireSignature: boolean;
  trustedKeysPath: string | null;
  spawnFn?: SpawnFn;
}

export type VerifyResult =
  | {ok: true; reason: 'signature-verified' | 'signature-not-required'}
  | {ok: false; reason: 'signature-verification-failed'};

/**
 * Verify a release tag's GPG signature. With requireSignature=false (default)
 * this is a documented no-op — Etherpad's release process does not yet sign
 * tags consistently and forcing verification on by default would break Tier 2
 * for everyone. Admins who manage their own builds set requireSignature=true
 * and import their trusted keys into the Etherpad user's keyring (or a
 * dedicated one via trustedKeysPath -> $GNUPGHOME).
 */
export const verifyReleaseTag = async (args: VerifyArgs): Promise<VerifyResult> => {
  if (!args.requireSignature) {
    logger.warn(`verifyReleaseTag: signature check skipped (updates.requireSignature=false) for ${args.tag}`);
    return {ok: true, reason: 'signature-not-required'};
  }
  const spawnFn = args.spawnFn ?? (realSpawn as unknown as SpawnFn);
  const env: NodeJS.ProcessEnv = {...process.env};
  if (args.trustedKeysPath) env.GNUPGHOME = args.trustedKeysPath;
  const child = spawnFn('git', ['verify-tag', args.tag], {cwd: args.repoDir, env, stdio: 'ignore'});
  const code: number | null = await new Promise((resolve) => child.on('close', resolve));
  if (code === 0) return {ok: true, reason: 'signature-verified'};
  return {ok: false, reason: 'signature-verification-failed'};
};
```

- [ ] **Step 4: Run — pass**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/trustedKeys.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/trustedKeys.ts src/tests/backend-new/specs/updater/trustedKeys.test.ts
git commit -m "$(cat <<'EOF'
feat(updater): verifyReleaseTag — gpg-via-git stub for Tier 2 preflight

Default updates.requireSignature=false: log a warning and return ok.
Set true to make preflight refuse a tag whose signature does not verify
under the system keyring (or trustedKeysPath via GNUPGHOME). Etherpad's
release process does not yet sign tags consistently; turning the check
on by default would break Tier 2 for every admin and forcing a release-
signing change is out of scope for this PR.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Pre-flight checks

**Files:**
- Create: `src/node/updater/preflight.ts`
- Test: `src/tests/backend-new/specs/updater/preflight.test.ts`

The `runPreflight` function takes everything it needs as injected dependencies — no direct fs/spawn — so unit tests can stub each individual check.

- [ ] **Step 1: Failing test**

Create `src/tests/backend-new/specs/updater/preflight.test.ts`:

```typescript
import {describe, it, expect, vi} from 'vitest';
import {runPreflight} from '../../../../node/updater/preflight';

const baseDeps = {
  installMethod: 'git' as const,
  workingTreeClean: vi.fn(async () => true),
  freeDiskMB: vi.fn(async () => 5000),
  pnpmOnPath: vi.fn(async () => true),
  lockHeld: vi.fn(async () => false),
  remoteHasTag: vi.fn(async () => true),
  verifyTag: vi.fn(async () => ({ok: true as const, reason: 'signature-not-required' as const})),
};

const baseInput = {
  targetTag: 'v2.7.3',
  diskSpaceMinMB: 500,
  requireSignature: false,
  trustedKeysPath: null,
};

describe('runPreflight', () => {
  it('passes when all checks pass', async () => {
    const r = await runPreflight(baseInput, {...baseDeps});
    expect(r).toEqual({ok: true});
  });

  it('rejects non-writable install methods', async () => {
    const r = await runPreflight(baseInput, {...baseDeps, installMethod: 'docker'});
    expect(r).toEqual({ok: false, reason: 'install-method-not-writable'});
  });

  it('rejects a dirty working tree', async () => {
    const r = await runPreflight(baseInput, {...baseDeps, workingTreeClean: vi.fn(async () => false)});
    expect(r).toEqual({ok: false, reason: 'dirty-working-tree'});
  });

  it('rejects insufficient disk space', async () => {
    const r = await runPreflight(baseInput, {...baseDeps, freeDiskMB: vi.fn(async () => 100)});
    expect(r).toEqual({ok: false, reason: 'low-disk-space'});
  });

  it('rejects when pnpm is missing', async () => {
    const r = await runPreflight(baseInput, {...baseDeps, pnpmOnPath: vi.fn(async () => false)});
    expect(r).toEqual({ok: false, reason: 'pnpm-not-found'});
  });

  it('rejects when the lock is held', async () => {
    const r = await runPreflight(baseInput, {...baseDeps, lockHeld: vi.fn(async () => true)});
    expect(r).toEqual({ok: false, reason: 'lock-held'});
  });

  it('rejects when the remote tag is missing', async () => {
    const r = await runPreflight(baseInput, {...baseDeps, remoteHasTag: vi.fn(async () => false)});
    expect(r).toEqual({ok: false, reason: 'remote-tag-missing'});
  });

  it('rejects when signature verification fails', async () => {
    const r = await runPreflight(baseInput, {
      ...baseDeps,
      verifyTag: vi.fn(async () => ({ok: false as const, reason: 'signature-verification-failed' as const})),
    });
    expect(r).toEqual({ok: false, reason: 'signature-verification-failed'});
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/preflight.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/node/updater/preflight.ts`:

```typescript
import {InstallMethod} from './types';
import type {VerifyResult} from './trustedKeys';

export type PreflightReason =
  | 'install-method-not-writable'
  | 'dirty-working-tree'
  | 'low-disk-space'
  | 'pnpm-not-found'
  | 'lock-held'
  | 'remote-tag-missing'
  | 'signature-verification-failed';

export interface PreflightInput {
  targetTag: string;
  diskSpaceMinMB: number;
  requireSignature: boolean;
  trustedKeysPath: string | null;
}

export interface PreflightDeps {
  installMethod: Exclude<InstallMethod, 'auto'>;
  workingTreeClean: () => Promise<boolean>;
  freeDiskMB: () => Promise<number>;
  pnpmOnPath: () => Promise<boolean>;
  lockHeld: () => Promise<boolean>;
  remoteHasTag: (tag: string) => Promise<boolean>;
  verifyTag: () => Promise<VerifyResult>;
}

export type PreflightResult = {ok: true} | {ok: false; reason: PreflightReason};

const WRITABLE: ReadonlySet<Exclude<InstallMethod, 'auto'>> = new Set(['git']);

/**
 * Sequenced preflight: each check is fast and reads the world. Order matters —
 * cheap, definitive failures (install method) run before slow ones (network tag
 * lookup, gpg). The first failure short-circuits.
 */
export const runPreflight = async (
  input: PreflightInput,
  deps: PreflightDeps,
): Promise<PreflightResult> => {
  if (!WRITABLE.has(deps.installMethod)) return {ok: false, reason: 'install-method-not-writable'};
  if (!await deps.workingTreeClean()) return {ok: false, reason: 'dirty-working-tree'};
  if ((await deps.freeDiskMB()) < input.diskSpaceMinMB) return {ok: false, reason: 'low-disk-space'};
  if (!await deps.pnpmOnPath()) return {ok: false, reason: 'pnpm-not-found'};
  if (await deps.lockHeld()) return {ok: false, reason: 'lock-held'};
  if (!await deps.remoteHasTag(input.targetTag)) return {ok: false, reason: 'remote-tag-missing'};
  const sig = await deps.verifyTag();
  if (!sig.ok) return {ok: false, reason: 'signature-verification-failed'};
  return {ok: true};
};
```

- [ ] **Step 4: Run — pass**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/preflight.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/preflight.ts src/tests/backend-new/specs/updater/preflight.test.ts
git commit -m "$(cat <<'EOF'
feat(updater): preflight check pipeline for Tier 2

Pure orchestrator over injected probes for install-method, working tree,
disk space, pnpm presence, lock state, remote tag existence and signature
verification. Cheap-and-definitive checks run first; first failure short-
circuits with a typed reason that the route layer will surface in the
preflight-failed admin banner.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update log appender + tail

**Files:**
- Create: `src/node/updater/updateLog.ts`
- Test: `src/tests/backend-new/specs/updater/updateLog.test.ts`

A dedicated log4js logger writes to `var/log/update.log` with a 10 MB × 5 rolling-file appender. `tailLines(n)` reads the most recent `n` lines from the active log file for the `/admin/update/log` endpoint.

- [ ] **Step 1: Failing test**

Create `src/tests/backend-new/specs/updater/updateLog.test.ts`:

```typescript
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {tailLines} from '../../../../node/updater/updateLog';

describe('tailLines', () => {
  let dir: string;
  let logPath: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-log-'));
    logPath = path.join(dir, 'update.log');
  });
  afterEach(async () => { await fs.rm(dir, {recursive: true, force: true}); });

  it('returns [] when file is missing', async () => {
    expect(await tailLines(logPath, 10)).toEqual([]);
  });

  it('returns up to N lines when file is shorter', async () => {
    await fs.writeFile(logPath, 'a\nb\nc\n');
    expect(await tailLines(logPath, 10)).toEqual(['a', 'b', 'c']);
  });

  it('returns the last N when file is longer', async () => {
    const lines = Array.from({length: 500}, (_, i) => `line-${i}`);
    await fs.writeFile(logPath, lines.join('\n') + '\n');
    expect(await tailLines(logPath, 5)).toEqual(['line-495', 'line-496', 'line-497', 'line-498', 'line-499']);
  });

  it('handles a final-line-without-newline', async () => {
    await fs.writeFile(logPath, 'a\nb\nc');
    expect(await tailLines(logPath, 10)).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/updateLog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/node/updater/updateLog.ts`:

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import log4js from 'log4js';

let configured = false;

/** Idempotently register a rolling-file appender for the updater log. */
export const ensureUpdateLogAppender = (logPath: string): void => {
  if (configured) return;
  const dir = path.dirname(logPath);
  // mkdir is sync-best-effort: log4js will surface any deeper failure on first write.
  try { require('node:fs').mkdirSync(dir, {recursive: true}); } catch {/* noop */}
  const cfg: any = log4js.getConfig?.() ?? null;
  // We don't try to mutate an arbitrary external log4js config — we just add our category.
  log4js.addLayout?.('json', () => (e: any) => JSON.stringify({t: e.startTime, lvl: e.level.levelStr, m: e.data.join(' ')}));
  log4js.configure({
    appenders: {
      ...(cfg?.appenders || {}),
      updateLog: {type: 'file', filename: logPath, maxLogSize: 10 * 1024 * 1024, backups: 5, compress: false},
    },
    categories: {
      ...(cfg?.categories || {default: {appenders: ['out'], level: 'info'}}),
      updater: {appenders: ['updateLog'], level: 'info'},
    },
  });
  configured = true;
};

/** Read the last `n` newline-separated lines from the active log file. Empty array if missing. */
export const tailLines = async (logPath: string, n: number): Promise<string[]> => {
  let raw: string;
  try { raw = await fs.readFile(logPath, 'utf8'); }
  catch (err: any) { if (err.code === 'ENOENT') return []; throw err; }
  const stripped = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  if (stripped.length === 0) return [];
  const all = stripped.split('\n');
  return all.slice(Math.max(0, all.length - n));
};
```

> **Note on `log4js.configure`:** Etherpad's main entrypoint already calls `log4js.configure` once. Calling it again replaces the config. The `cfg = log4js.getConfig?.()` spread above preserves the existing appenders and categories so we only *add* `updateLog` and the `updater` category. If `getConfig` isn't exposed in the runtime version of log4js, the fallback writes both `default` and `updater` so existing log lines still go somewhere — verify behaviour with the smoke test below.

- [ ] **Step 4: Run — pass**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/updateLog.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Smoke-test the appender against the real boot path**

Run: `pnpm run dev -- --port 9003 &` (start in background) then `tail -n 20 var/log/etherpad.log`. Confirm normal logs still appear, then `curl -fsSL http://localhost:9003/health` and verify the existing `default` appender output is unchanged. Stop with `kill %1`.

If existing logs disappear, the spread of `cfg.appenders/categories` did not preserve them — adjust `ensureUpdateLogAppender` to use the appender registration API rather than `configure`. (Concretely: many log4js builds support `log4js.recording()` or one can keep a reference to the original config from `Settings.ts`'s `log4js.configure(...)` call and re-apply it merged. If the `getConfig?` path returns `null`, fall back to copying the layout from `settings.logconfig` which is what `Settings.ts` builds.)

- [ ] **Step 6: Commit**

```bash
git add src/node/updater/updateLog.ts src/tests/backend-new/specs/updater/updateLog.test.ts
git commit -m "$(cat <<'EOF'
feat(updater): rolling update.log appender + tailLines helper

ensureUpdateLogAppender adds a 10MB x 5 rolling-file appender for the
'updater' log4js category at var/log/update.log; tailLines reads the
last N lines for the /admin/update/log streaming endpoint without
loading the whole file into memory if a partial read suffices.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: SessionDrainer

**Files:**
- Create: `src/node/updater/SessionDrainer.ts`
- Test: `src/tests/backend-new/specs/updater/SessionDrainer.test.ts`

The drainer schedules three broadcasts (T-60, T-30, T-10), flips a module-level "no new connections" flag, and resolves a promise at T=0. The flag is read by a lightweight check we'll add to PadMessageHandler in this same task. Tests use fake timers and a stubbed broadcaster.

- [ ] **Step 1: Failing test**

Create `src/tests/backend-new/specs/updater/SessionDrainer.test.ts`:

```typescript
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {createDrainer, isAcceptingConnections, _resetForTests} from '../../../../node/updater/SessionDrainer';

describe('SessionDrainer', () => {
  beforeEach(() => { vi.useFakeTimers(); _resetForTests(); });
  afterEach(() => { vi.useRealTimers(); _resetForTests(); });

  it('emits T-60, T-30, T-10 and resolves at T=0', async () => {
    const broadcasts: Array<{at: number; key: string}> = [];
    const drainer = createDrainer({
      drainSeconds: 60,
      broadcast: (key, _values) => { broadcasts.push({at: Date.now(), key}); },
    });
    const start = Date.now();
    const done = drainer.start();
    // T-60 broadcast fires immediately on start.
    expect(broadcasts.map((b) => b.key)).toEqual(['update.drain.t60']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(broadcasts.map((b) => b.key)).toEqual(['update.drain.t60', 'update.drain.t30']);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(broadcasts.map((b) => b.key)).toEqual([
      'update.drain.t60', 'update.drain.t30', 'update.drain.t10',
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(Date.now() - start).toBe(60_000);
  });

  it('flips isAcceptingConnections to false during drain and back on cancel', () => {
    const drainer = createDrainer({drainSeconds: 60, broadcast: () => {}});
    expect(isAcceptingConnections()).toBe(true);
    drainer.start();
    expect(isAcceptingConnections()).toBe(false);
    drainer.cancel();
    expect(isAcceptingConnections()).toBe(true);
  });

  it('cancel before T=0 resolves the start() promise as cancelled', async () => {
    const drainer = createDrainer({drainSeconds: 60, broadcast: () => {}});
    const done = drainer.start();
    await vi.advanceTimersByTimeAsync(20_000);
    drainer.cancel();
    const r = await done;
    expect(r).toEqual({outcome: 'cancelled'});
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/SessionDrainer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/node/updater/SessionDrainer.ts`:

```typescript
let acceptingConnections = true;

export const isAcceptingConnections = (): boolean => acceptingConnections;
export const _resetForTests = (): void => { acceptingConnections = true; };

export interface DrainerOpts {
  drainSeconds: number;
  /** Called for every broadcast; the i18n key is fixed but `values` may carry timing data. */
  broadcast: (i18nKey: 'update.drain.t60' | 'update.drain.t30' | 'update.drain.t10', values: Record<string, unknown>) => void;
}

export interface Drainer {
  start: () => Promise<{outcome: 'completed' | 'cancelled'}>;
  cancel: () => void;
}

export const createDrainer = ({drainSeconds, broadcast}: DrainerOpts): Drainer => {
  const timers: NodeJS.Timeout[] = [];
  let resolveDone: ((r: {outcome: 'completed' | 'cancelled'}) => void) | null = null;
  let cancelled = false;

  const fire = (k: 'update.drain.t60' | 'update.drain.t30' | 'update.drain.t10', secondsRemaining: number) => {
    if (cancelled) return;
    broadcast(k, {seconds: secondsRemaining});
  };

  const start = (): Promise<{outcome: 'completed' | 'cancelled'}> => {
    if (resolveDone) return Promise.reject(new Error('drainer already started'));
    acceptingConnections = false;
    return new Promise((resolve) => {
      resolveDone = resolve;
      const ms = drainSeconds * 1000;
      // T-60 broadcast fires at start; T-30 and T-10 at offsets.
      fire('update.drain.t60', drainSeconds);
      timers.push(setTimeout(() => fire('update.drain.t30', 30), Math.max(0, ms - 30_000)));
      timers.push(setTimeout(() => fire('update.drain.t10', 10), Math.max(0, ms - 10_000)));
      timers.push(setTimeout(() => {
        if (cancelled) return;
        acceptingConnections = true; // executor takes over from here; flag goes back on after exit/restart anyway
        resolveDone?.({outcome: 'completed'});
        resolveDone = null;
      }, ms));
    });
  };

  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
    acceptingConnections = true;
    resolveDone?.({outcome: 'cancelled'});
    resolveDone = null;
  };

  return {start, cancel};
};
```

- [ ] **Step 4: Run — pass**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/SessionDrainer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire `isAcceptingConnections` into the socket handshake**

In `src/node/handler/PadMessageHandler.ts`, near the top of `handleMessage` (or wherever new socket connections enter the pad-message pipeline — pick the function that runs on every incoming socket and short-circuits before the Pad lookup), add:

```typescript
import {isAcceptingConnections} from '../updater/SessionDrainer';

// ...inside the connection-accept path, before any expensive work:
if (!isAcceptingConnections()) {
  socket.json.send({disconnect: 'updateInProgress'});
  socket.disconnect(true);
  return;
}
```

Locate the existing connection-accept path with: `grep -nE "handleMessage|handleClientReady" src/node/handler/PadMessageHandler.ts | head`. Place the guard inside `handleClientReady` before the Pad is fetched.

- [ ] **Step 6: Add a regression test for the guard**

Create `src/tests/backend-new/specs/updater/drainer-handshake.test.ts`:

```typescript
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';

describe('PadMessageHandler refuses connections during drain', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.resetModules(); });

  it('handleClientReady disconnects when isAcceptingConnections is false', async () => {
    vi.doMock('../../../../node/updater/SessionDrainer', () => ({
      isAcceptingConnections: () => false,
    }));
    const PadMessageHandler = await import('../../../../node/handler/PadMessageHandler');
    const sent: any[] = [];
    let disconnected = false;
    const fakeSocket: any = {
      id: 'sock-1',
      json: {send: (m: unknown) => sent.push(m)},
      disconnect: () => { disconnected = true; },
      conn: {request: {}},
    };
    // handleClientReady takes (socket, message); message can be a stub.
    if (typeof (PadMessageHandler as any).handleClientReady === 'function') {
      await (PadMessageHandler as any).handleClientReady(fakeSocket, {padId: 'doesntmatter'});
    } else {
      // Fallback to handleMessage if handleClientReady is private.
      await (PadMessageHandler as any).handleMessage(fakeSocket, {type: 'CLIENT_READY', padId: 'doesntmatter'});
    }
    expect(disconnected).toBe(true);
    expect(sent[0]).toEqual({disconnect: 'updateInProgress'});
  });
});
```

- [ ] **Step 7: Run — pass**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/`
Expected: all updater unit tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/node/updater/SessionDrainer.ts src/node/handler/PadMessageHandler.ts \
  src/tests/backend-new/specs/updater/SessionDrainer.test.ts \
  src/tests/backend-new/specs/updater/drainer-handshake.test.ts
git commit -m "$(cat <<'EOF'
feat(updater): SessionDrainer + handshake guard

Drainer schedules T-60/-30/-10 shoutMessage broadcasts and resolves at T=0;
PadMessageHandler short-circuits new CLIENT_READY messages while the
drainer's flag is off, so admins applying an update don't get a stampede
of fresh sockets between the broadcast and exit 75.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: UpdateExecutor

**Files:**
- Create: `src/node/updater/UpdateExecutor.ts`
- Test: `src/tests/backend-new/specs/updater/UpdateExecutor.test.ts`

The executor accepts injected `spawnFn`, `fs`, `now`, `exit`, and `saveState` so unit tests run without spawning real children or mutating the real install. It writes `state.execution` at every transition and copies `pnpm-lock.yaml` + the current SHA to `var/update-backup/` before any mutation.

- [ ] **Step 1: Failing test**

Create `src/tests/backend-new/specs/updater/UpdateExecutor.test.ts`:

```typescript
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {executeUpdate} from '../../../../node/updater/UpdateExecutor';
import {EMPTY_STATE} from '../../../../node/updater/types';

const okSpawn = (script: Array<{cmd: string; exit: number; stderr?: string}>) => {
  let i = 0;
  return vi.fn((cmd: string, args: string[]) => {
    const step = script[i++];
    if (!step) throw new Error(`Unexpected spawn call: ${cmd} ${args.join(' ')}`);
    if (step.cmd !== `${cmd} ${args.join(' ')}`) {
      throw new Error(`Spawn order mismatch: expected "${step.cmd}", got "${cmd} ${args.join(' ')}"`);
    }
    return {
      stdout: {on: () => {}}, stderr: {on: (e: string, cb: any) => step.stderr && e === 'data' && cb(Buffer.from(step.stderr))},
      on: (e: string, cb: any) => e === 'close' && setTimeout(() => cb(step.exit), 0),
    } as any;
  });
};

describe('executeUpdate happy path', () => {
  let savedStates: any[] = [];
  let written: Record<string, string> = {};
  let exited: number | null = null;

  beforeEach(() => { savedStates = []; written = {}; exited = null; });

  const baseDeps = () => ({
    repoDir: '/srv/etherpad',
    backupDir: '/srv/etherpad/var/update-backup',
    spawnFn: okSpawn([
      {cmd: 'git rev-parse HEAD', exit: 0},
      {cmd: 'git fetch --tags origin', exit: 0},
      {cmd: 'git checkout v2.7.3', exit: 0},
      {cmd: 'pnpm install --frozen-lockfile', exit: 0},
      {cmd: 'pnpm run build:ui', exit: 0},
    ]),
    readSha: vi.fn(async () => 'abc123'),
    copyFile: vi.fn(async (_a: string, _b: string) => { written[_b] = 'lock'; }),
    saveState: vi.fn(async (s: any) => { savedStates.push(structuredClone(s)); }),
    initialState: structuredClone(EMPTY_STATE),
    targetTag: 'v2.7.3',
    now: () => new Date('2026-05-08T10:00:00Z'),
    exit: (code: number) => { exited = code; },
  });

  it('snapshots, runs steps, persists pending-verification, exits 75', async () => {
    const deps = baseDeps();
    const result = await executeUpdate(deps);
    expect(result).toEqual({outcome: 'pending-verification'});
    expect(deps.copyFile).toHaveBeenCalledWith(
      '/srv/etherpad/pnpm-lock.yaml',
      '/srv/etherpad/var/update-backup/pnpm-lock.yaml',
    );
    expect(savedStates.at(-1).execution.status).toBe('pending-verification');
    expect(savedStates.at(-1).execution.fromSha).toBe('abc123');
    expect(savedStates.at(-1).bootCount).toBe(0);
    expect(exited).toBe(75);
  });

  it('install failure flips state to rolling-back', async () => {
    const deps = baseDeps();
    deps.spawnFn = okSpawn([
      {cmd: 'git rev-parse HEAD', exit: 0},
      {cmd: 'git fetch --tags origin', exit: 0},
      {cmd: 'git checkout v2.7.3', exit: 0},
      {cmd: 'pnpm install --frozen-lockfile', exit: 1, stderr: 'resolver bork'},
    ]);
    const result = await executeUpdate(deps);
    expect(result.outcome).toBe('failed-install');
    expect(savedStates.at(-1).execution.status).toBe('rolling-back');
    expect(exited).toBe(null); // executor does not exit; rollback path drives the next exit
  });

  it('build failure flips state to rolling-back', async () => {
    const deps = baseDeps();
    deps.spawnFn = okSpawn([
      {cmd: 'git rev-parse HEAD', exit: 0},
      {cmd: 'git fetch --tags origin', exit: 0},
      {cmd: 'git checkout v2.7.3', exit: 0},
      {cmd: 'pnpm install --frozen-lockfile', exit: 0},
      {cmd: 'pnpm run build:ui', exit: 2},
    ]);
    const result = await executeUpdate(deps);
    expect(result.outcome).toBe('failed-build');
    expect(savedStates.at(-1).execution.status).toBe('rolling-back');
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/UpdateExecutor.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/node/updater/UpdateExecutor.ts`:

```typescript
import path from 'node:path';
import log4js from 'log4js';
import {SpawnOptions} from 'node:child_process';
import {UpdateState} from './types';

const logger = log4js.getLogger('updater');

export type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => {
  stdout: {on: (event: 'data', cb: (chunk: Buffer) => void) => void};
  stderr: {on: (event: 'data', cb: (chunk: Buffer) => void) => void};
  on: (event: 'close', cb: (code: number | null) => void) => void;
};

export interface ExecutorDeps {
  repoDir: string;
  backupDir: string;
  spawnFn: SpawnFn;
  readSha: () => Promise<string>;
  copyFile: (src: string, dst: string) => Promise<void>;
  saveState: (s: UpdateState) => Promise<void>;
  initialState: UpdateState;
  targetTag: string;
  now: () => Date;
  exit: (code: number) => void;
}

export type ExecutorResult =
  | {outcome: 'pending-verification'}
  | {outcome: 'failed-install'; reason: string}
  | {outcome: 'failed-build'; reason: string}
  | {outcome: 'failed-checkout'; reason: string};

const runStep = (spawnFn: SpawnFn, repoDir: string, cmd: string, args: string[]):
    Promise<{code: number | null; stderr: string}> => new Promise((resolve) => {
  let stderr = '';
  const child = spawnFn(cmd, args, {cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.on('data', (chunk: Buffer) => logger.info(`[${cmd}] ${chunk.toString().trimEnd()}`));
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); logger.warn(`[${cmd}] ${chunk.toString().trimEnd()}`); });
  child.on('close', (code) => resolve({code, stderr}));
});

/**
 * Run the update pipeline. Each step writes state before/after so a hard kill
 * mid-step lands the next boot in a known state for RollbackHandler to resolve.
 *
 * On install/build failure the executor transitions to `rolling-back`, persists,
 * and returns. The route layer hands control to RollbackHandler which restores
 * the lockfile and SHA. The executor does NOT exit on failure paths — the
 * rollback path owns that exit.
 */
export const executeUpdate = async (deps: ExecutorDeps): Promise<ExecutorResult> => {
  const fromSha = await deps.readSha();
  let s: UpdateState = {
    ...deps.initialState,
    execution: {status: 'executing', targetTag: deps.targetTag, fromSha, startedAt: deps.now().toISOString()},
    bootCount: 0,
  };
  await deps.saveState(s);

  // Snapshot lockfile (SHA captured above).
  await deps.copyFile(path.join(deps.repoDir, 'pnpm-lock.yaml'), path.join(deps.backupDir, 'pnpm-lock.yaml'));

  const fail = async (
    outcome: 'failed-install' | 'failed-build' | 'failed-checkout',
    reason: string,
  ): Promise<ExecutorResult> => {
    s = {
      ...s,
      execution: {status: 'rolling-back', reason, targetTag: deps.targetTag, fromSha, at: deps.now().toISOString()},
    };
    await deps.saveState(s);
    logger.error(`update step failed (${outcome}): ${reason}`);
    return {outcome, reason};
  };

  let r = await runStep(deps.spawnFn, deps.repoDir, 'git', ['fetch', '--tags', 'origin']);
  if (r.code !== 0) return fail('failed-checkout', `git fetch exit ${r.code}: ${r.stderr.trim()}`);

  r = await runStep(deps.spawnFn, deps.repoDir, 'git', ['checkout', deps.targetTag]);
  if (r.code !== 0) return fail('failed-checkout', `git checkout exit ${r.code}: ${r.stderr.trim()}`);

  r = await runStep(deps.spawnFn, deps.repoDir, 'pnpm', ['install', '--frozen-lockfile']);
  if (r.code !== 0) return fail('failed-install', `pnpm install exit ${r.code}: ${r.stderr.trim()}`);

  r = await runStep(deps.spawnFn, deps.repoDir, 'pnpm', ['run', 'build:ui']);
  if (r.code !== 0) return fail('failed-build', `pnpm run build:ui exit ${r.code}: ${r.stderr.trim()}`);

  // Pending-verification: the next boot's RollbackHandler arms the health-check timer.
  s = {
    ...s,
    execution: {
      status: 'pending-verification',
      targetTag: deps.targetTag,
      fromSha,
      // RollbackHandler computes the actual deadline at boot using rollbackHealthCheckSeconds.
      // We persist a placeholder so the field is present.
      deadlineAt: deps.now().toISOString(),
    },
    bootCount: 0,
  };
  await deps.saveState(s);
  logger.info(`update executed: ${fromSha} -> ${deps.targetTag}; exiting 75 for supervisor restart`);
  deps.exit(75);
  return {outcome: 'pending-verification'};
};
```

> The test stubs `readSha`/`copyFile`/`saveState` because the production caller (in Task 11) provides real implementations. The executor's body never imports `node:fs` or real spawn — keeping the unit test fast and isolated.

- [ ] **Step 4: Run — pass**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/UpdateExecutor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/UpdateExecutor.ts src/tests/backend-new/specs/updater/UpdateExecutor.test.ts
git commit -m "$(cat <<'EOF'
feat(updater): UpdateExecutor — snapshot, fetch/checkout/install/build, exit 75

Pure-DI orchestrator: every shell-out goes through an injected spawnFn,
every fs touch through an injected fs facade, every state write through
the saveState dependency. Unit tests cover the happy path + the install
and build failure transitions to rolling-back. The rollback path itself
lives in Task 8 (RollbackHandler); on failure the executor persists
state and returns without exiting so the route layer can run rollback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: RollbackHandler

**Files:**
- Create: `src/node/updater/RollbackHandler.ts`
- Test: `src/tests/backend-new/specs/updater/RollbackHandler.test.ts`

Two paths:

1. **`checkPendingVerification(state)`** runs at boot. If `state.execution.status === 'pending-verification'`, increment `bootCount`, persist, and either (a) if `bootCount > 2` force an immediate rollback, or (b) arm a 60s timer that on expiry rolls back, on success marks `verified`. Health success is signalled externally — for PR 2 we treat completion of boot through `expressCreateServer` as the success signal (RollbackHandler exposes a `markVerified()` callable).
2. **`performRollback(reason)`** runs from inside the executor's failure paths *and* from the boot-time crash-loop / health-timeout paths. It copies the backup lockfile back, runs `git checkout <fromSha>`, `pnpm install --frozen-lockfile`, persists `rolled-back` (or `rollback-failed` on any sub-step error), and exits 75.

- [ ] **Step 1: Failing test**

Create `src/tests/backend-new/specs/updater/RollbackHandler.test.ts`:

```typescript
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {checkPendingVerification, performRollback} from '../../../../node/updater/RollbackHandler';
import {EMPTY_STATE} from '../../../../node/updater/types';

const baseDeps = () => ({
  repoDir: '/srv/etherpad',
  backupDir: '/srv/etherpad/var/update-backup',
  spawnFn: vi.fn((_c: string, _a: string[]) => ({
    stdout: {on: () => {}}, stderr: {on: () => {}},
    on: (e: string, cb: any) => e === 'close' && setTimeout(() => cb(0), 0),
  })) as any,
  copyFile: vi.fn(async (_a: string, _b: string) => {}),
  saveState: vi.fn(async (_s: any) => {}),
  exit: vi.fn((_code: number) => {}),
  now: () => new Date('2026-05-08T10:00:00Z'),
});

describe('checkPendingVerification', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('idle state is a no-op', async () => {
    const r = checkPendingVerification(structuredClone(EMPTY_STATE), {
      ...baseDeps(), rollbackHealthCheckSeconds: 60,
    });
    expect(r.armed).toBe(false);
  });

  it('pending-verification with bootCount<=2 arms a timer and increments bootCount', async () => {
    const deps = baseDeps();
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {status: 'pending-verification', targetTag: 'v2.7.3', fromSha: 'abc', deadlineAt: '2026-05-08T10:00:00Z'} as const,
      bootCount: 0,
    };
    const r = checkPendingVerification(state, {...deps, rollbackHealthCheckSeconds: 60});
    expect(r.armed).toBe(true);
    // bootCount has been bumped and state persisted.
    expect(deps.saveState).toHaveBeenCalledWith(expect.objectContaining({bootCount: 1}));
    // markVerified clears the timer and lands on `verified`.
    r.markVerified();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it('pending-verification with bootCount>2 forces immediate rollback', async () => {
    const deps = baseDeps();
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {status: 'pending-verification', targetTag: 'v2.7.3', fromSha: 'abc', deadlineAt: '2026-05-08T10:00:00Z'} as const,
      bootCount: 3,
    };
    const r = checkPendingVerification(state, {...deps, rollbackHealthCheckSeconds: 60});
    expect(r.armed).toBe(false);
    // Rollback ran; exit 75 was called once we hit the end of performRollback.
    await vi.runAllTimersAsync();
    expect(deps.exit).toHaveBeenCalledWith(75);
  });

  it('timer expiry triggers rollback when markVerified is never called', async () => {
    const deps = baseDeps();
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {status: 'pending-verification', targetTag: 'v2.7.3', fromSha: 'abc', deadlineAt: '2026-05-08T10:00:00Z'} as const,
      bootCount: 0,
    };
    const r = checkPendingVerification(state, {...deps, rollbackHealthCheckSeconds: 60});
    expect(r.armed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.exit).toHaveBeenCalledWith(75);
  });
});

describe('performRollback', () => {
  it('happy path: restores lockfile, checkout from-sha, pnpm install, exit 75, status=rolled-back', async () => {
    const deps = baseDeps();
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {status: 'rolling-back', reason: 'install-failed', targetTag: 'v2.7.3', fromSha: 'abc', at: '2026-05-08T10:00:00Z'} as const,
      bootCount: 0,
    };
    await performRollback(state, {...deps, rollbackHealthCheckSeconds: 60});
    expect(deps.copyFile).toHaveBeenCalledWith(
      '/srv/etherpad/var/update-backup/pnpm-lock.yaml',
      '/srv/etherpad/pnpm-lock.yaml',
    );
    expect(deps.saveState).toHaveBeenLastCalledWith(expect.objectContaining({
      execution: expect.objectContaining({status: 'rolled-back'}),
      lastResult: expect.objectContaining({outcome: 'rolled-back'}),
    }));
    expect(deps.exit).toHaveBeenCalledWith(75);
  });

  it('rollback failure lands on rollback-failed (terminal)', async () => {
    const deps = baseDeps();
    let i = 0;
    deps.spawnFn = vi.fn(() => ({
      stdout: {on: () => {}}, stderr: {on: () => {}},
      on: (e: string, cb: any) => e === 'close' && setTimeout(() => cb(i++ === 0 ? 0 : 1), 0),
    })) as any;
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {status: 'rolling-back', reason: 'install-failed', targetTag: 'v2.7.3', fromSha: 'abc', at: '2026-05-08T10:00:00Z'} as const,
      bootCount: 0,
    };
    await performRollback(state, {...deps, rollbackHealthCheckSeconds: 60});
    expect(deps.saveState).toHaveBeenLastCalledWith(expect.objectContaining({
      execution: expect.objectContaining({status: 'rollback-failed'}),
      lastResult: expect.objectContaining({outcome: 'rollback-failed'}),
    }));
    expect(deps.exit).toHaveBeenCalledWith(75);
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/RollbackHandler.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/node/updater/RollbackHandler.ts`:

```typescript
import path from 'node:path';
import log4js from 'log4js';
import {SpawnOptions} from 'node:child_process';
import {UpdateState} from './types';
import type {SpawnFn} from './UpdateExecutor';

const logger = log4js.getLogger('updater');

export interface RollbackDeps {
  repoDir: string;
  backupDir: string;
  spawnFn: SpawnFn;
  copyFile: (src: string, dst: string) => Promise<void>;
  saveState: (s: UpdateState) => Promise<void>;
  exit: (code: number) => void;
  now: () => Date;
  rollbackHealthCheckSeconds: number;
}

const runStep = (spawnFn: SpawnFn, cwd: string, cmd: string, args: string[]):
    Promise<number | null> => new Promise((resolve) => {
  const child = spawnFn(cmd, args, {cwd, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.on('data', (b: Buffer) => logger.info(`[${cmd}] ${b.toString().trimEnd()}`));
  child.stderr.on('data', (b: Buffer) => logger.warn(`[${cmd}] ${b.toString().trimEnd()}`));
  child.on('close', (c) => resolve(c));
});

/** Restore the previous SHA + lockfile. Lands on `rolled-back` on success, `rollback-failed` on any sub-step error. Always exits 75 so the supervisor restarts on a known state. */
export const performRollback = async (state: UpdateState, deps: RollbackDeps): Promise<void> => {
  const exec = state.execution;
  if (exec.status !== 'rolling-back' && exec.status !== 'pending-verification') {
    throw new Error(`performRollback called from unexpected status: ${exec.status}`);
  }
  const fromSha = (exec as {fromSha: string}).fromSha;
  const targetTag = (exec as {targetTag: string}).targetTag;
  const reason = exec.status === 'rolling-back' ? exec.reason : 'health-check-failed-or-crash-loop';
  const failTerminal = async (subReason: string): Promise<void> => {
    const at = deps.now().toISOString();
    await deps.saveState({
      ...state,
      execution: {status: 'rollback-failed', reason: `${reason}; rollback also failed: ${subReason}`, targetTag, fromSha, at},
      lastResult: {targetTag, fromSha, outcome: 'rollback-failed', reason: `${reason}; rollback failed: ${subReason}`, at},
      bootCount: 0,
    });
    logger.error(`rollback FAILED: ${subReason}; manual intervention required (POST /admin/update/acknowledge after fixing)`);
    deps.exit(75);
  };

  try {
    await deps.copyFile(path.join(deps.backupDir, 'pnpm-lock.yaml'), path.join(deps.repoDir, 'pnpm-lock.yaml'));
  } catch (err) {
    return failTerminal(`copy lockfile: ${(err as Error).message}`);
  }

  const checkoutCode = await runStep(deps.spawnFn, deps.repoDir, 'git', ['checkout', fromSha]);
  if (checkoutCode !== 0) return failTerminal(`git checkout ${fromSha} exit ${checkoutCode}`);

  const installCode = await runStep(deps.spawnFn, deps.repoDir, 'pnpm', ['install', '--frozen-lockfile']);
  if (installCode !== 0) return failTerminal(`pnpm install exit ${installCode}`);

  const at = deps.now().toISOString();
  await deps.saveState({
    ...state,
    execution: {status: 'rolled-back', reason, targetTag, restoredSha: fromSha, at},
    lastResult: {targetTag, fromSha, outcome: 'rolled-back', reason, at},
    bootCount: 0,
  });
  logger.warn(`rolled back to ${fromSha} (reason: ${reason})`);
  deps.exit(75);
};

export interface CheckResult {
  /** True if a health-check timer was armed and is awaiting markVerified or expiry. */
  armed: boolean;
  /** Cancels the timer and transitions to `verified`. No-op when armed is false. */
  markVerified: () => void;
}

/**
 * Inspect the persisted execution state at boot and react:
 *  - idle / verified / etc.: no-op.
 *  - pending-verification with bootCount > 2: force rollback (crash-loop guard).
 *  - pending-verification otherwise: increment bootCount, persist, arm a timer.
 */
export const checkPendingVerification = (state: UpdateState, deps: RollbackDeps): CheckResult => {
  const exec = state.execution;
  if (exec.status !== 'pending-verification') return {armed: false, markVerified: () => {}};

  if (state.bootCount > 2) {
    // Don't await — fire and forget so boot proceeds and exit happens asynchronously.
    void performRollback(state, deps);
    return {armed: false, markVerified: () => {}};
  }

  const incremented: UpdateState = {...state, bootCount: state.bootCount + 1};
  void deps.saveState(incremented);

  let cleared = false;
  const timer = setTimeout(() => {
    if (cleared) return;
    void performRollback({
      ...incremented,
      execution: {status: 'rolling-back', reason: 'health-check-timeout', targetTag: exec.targetTag, fromSha: exec.fromSha, at: deps.now().toISOString()},
    }, deps);
  }, deps.rollbackHealthCheckSeconds * 1000);

  return {
    armed: true,
    markVerified: () => {
      if (cleared) return;
      cleared = true;
      clearTimeout(timer);
      const at = deps.now().toISOString();
      void deps.saveState({
        ...incremented,
        execution: {status: 'verified', targetTag: exec.targetTag, verifiedAt: at},
        lastResult: {targetTag: exec.targetTag, fromSha: exec.fromSha, outcome: 'verified', reason: null, at},
        bootCount: 0,
      });
      logger.info(`update verified after restart: ${exec.fromSha} -> ${exec.targetTag}`);
    },
  };
};
```

- [ ] **Step 4: Run — pass**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/RollbackHandler.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/RollbackHandler.ts src/tests/backend-new/specs/updater/RollbackHandler.test.ts
git commit -m "$(cat <<'EOF'
feat(updater): RollbackHandler — health-check timer + crash-loop guard

checkPendingVerification arms a 60s health-check timer at boot when state
is pending-verification, increments bootCount, and forces an immediate
rollback when bootCount>2 (crash-loop guard). performRollback restores the
lockfile and SHA, retries pnpm install, and lands on rolled-back or the
terminal rollback-failed state on sub-step failure. Both paths exit 75 so
the supervisor restarts cleanly on the new known state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Wire RollbackHandler into the boot sequence

**Files:**
- Modify: `src/node/updater/index.ts`
- Modify: `src/node/hooks/express/updateStatus.ts` (extend status endpoint with execution + lastResult)
- Test: `src/tests/backend-new/specs/updater/index-boot.test.ts`

Boot sequence add: after `detectInstallMethod`, before `startPolling`, run `checkPendingVerification`. Stash the returned `markVerified` so `expressCreateServer`'s success path can call it once Etherpad is `RUNNING`.

- [ ] **Step 1: Failing test**

Create `src/tests/backend-new/specs/updater/index-boot.test.ts`:

```typescript
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';

describe('updater boot wiring', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.resetModules(); });

  it('calls checkPendingVerification with the loaded state', async () => {
    const calls: any[] = [];
    vi.doMock('../../../../node/updater/RollbackHandler', () => ({
      checkPendingVerification: (s: any) => { calls.push(s); return {armed: false, markVerified: () => {}}; },
      performRollback: vi.fn(),
    }));
    vi.doMock('../../../../node/updater/InstallMethodDetector', () => ({
      detectInstallMethod: vi.fn(async () => 'git'),
    }));
    vi.doMock('../../../../node/updater/state', () => ({
      loadState: vi.fn(async () => ({schemaVersion: 1, execution: {status: 'idle'}, bootCount: 0, lastResult: null,
        lastCheckAt: null, lastEtag: null, latest: null, vulnerableBelow: [],
        email: {severeAt: null, vulnerableAt: null, vulnerableNewReleaseTag: null}})),
      saveState: vi.fn(async () => {}),
    }));
    vi.doMock('../../../../node/utils/Settings', () => ({
      default: {root: '/srv/etherpad', updates: {tier: 'manual', githubRepo: 'ether/etherpad', checkIntervalHours: 6, installMethod: 'auto', rollbackHealthCheckSeconds: 60}, adminEmail: null},
      getEpVersion: () => '2.7.2',
    }));
    const updater = await import('../../../../node/updater');
    await updater.expressCreateServer();
    expect(calls).toHaveLength(1);
    await updater.shutdown();
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/index-boot.test.ts`
Expected: FAIL.

- [ ] **Step 3: Wire it up**

In `src/node/updater/index.ts`, add the import and the boot hook:

```typescript
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {checkPendingVerification, performRollback, CheckResult} from './RollbackHandler';
import {ensureUpdateLogAppender} from './updateLog';

let pendingVerification: CheckResult | null = null;

const rollbackDeps = () => ({
  repoDir: settings.root,
  backupDir: path.join(settings.root, 'var', 'update-backup'),
  spawnFn: spawn as unknown as import('./UpdateExecutor').SpawnFn,
  copyFile: (src: string, dst: string) => fs.copyFile(src, dst),
  saveState: (s: UpdateState) => saveState(stateFilePath(), s),
  exit: (code: number) => process.exit(code),
  now: () => new Date(),
  rollbackHealthCheckSeconds: Number(settings.updates.rollbackHealthCheckSeconds) || 60,
});
```

Replace `expressCreateServer` with:

```typescript
export const expressCreateServer = async (): Promise<void> => {
  ensureUpdateLogAppender(path.join(settings.root, 'var', 'log', 'update.log'));
  detectedMethod = await detectInstallMethod({
    override: settings.updates.installMethod,
    rootDir: settings.root,
  });
  logger.info(`updater: install method = ${detectedMethod}, tier = ${settings.updates.tier}`);

  const state = await getCurrentState();
  pendingVerification = checkPendingVerification(state, rollbackDeps());

  if (settings.updates.tier !== 'off') startPolling();
};

/** Called by the Etherpad runtime once the express stack is fully wired and /health is up. */
export const markBootHealthy = (): void => {
  if (pendingVerification) {
    pendingVerification.markVerified();
    pendingVerification = null;
  }
};

/** Exposed for routes. */
export const getRollbackDeps = rollbackDeps;
export const getPendingVerification = () => pendingVerification;
```

In `src/node/server.ts`, after the `state = State.RUNNING` line (around line 176), add:

```typescript
// Once the server is RUNNING, /health responds 200 — that is the implicit health
// signal the updater's pending-verification timer is waiting for.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./updater').markBootHealthy();
} catch (err) {
  logger.debug(`markBootHealthy: ${(err as Error).message}`);
}
```

In `src/node/hooks/express/updateStatus.ts`, extend the `/admin/update/status` response:

```typescript
res.json({
  currentVersion: current,
  latest: state.latest,
  lastCheckAt: state.lastCheckAt,
  installMethod,
  tier: settings.updates.tier,
  policy,
  vulnerableBelow: state.vulnerableBelow,
  // PR 2 additions:
  execution: state.execution,
  lastResult: state.lastResult,
  lockHeld: await import('../../updater/lock').then((m) => m.isHeld(require('node:path').join(settings.root, 'var', 'update.lock'))),
});
```

- [ ] **Step 4: Run — pass**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/index-boot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/index.ts src/node/server.ts src/node/hooks/express/updateStatus.ts \
  src/tests/backend-new/specs/updater/index-boot.test.ts
git commit -m "$(cat <<'EOF'
feat(updater): wire RollbackHandler into boot + extend /admin/update/status

expressCreateServer now invokes checkPendingVerification before polling
starts; server.ts calls markBootHealthy after state hits RUNNING so the
60s health-check timer cancels cleanly when the new version boots fine.
The status endpoint surfaces execution + lastResult + lockHeld so the
admin UI can render Apply / Cancel / Acknowledge state correctly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Refine UpdatePolicy for terminal-state gating

**Files:**
- Modify: `src/node/updater/UpdatePolicy.ts`
- Modify: `src/tests/backend-new/specs/updater/UpdatePolicy.test.ts`

`canAuto` and `canAutonomous` must return false while `execution.status === 'rollback-failed'` (manual remains allowed).

- [ ] **Step 1: Add failing tests**

Append to `UpdatePolicy.test.ts`:

```typescript
describe('terminal-state gating', () => {
  it('rollback-failed denies auto/autonomous but allows manual', () => {
    const r = evaluatePolicy({
      ...baseInput, tier: 'autonomous',
      executionStatus: 'rollback-failed',
    });
    expect(r.canManual).toBe(true);
    expect(r.canAuto).toBe(false);
    expect(r.canAutonomous).toBe(false);
    expect(r.reason).toBe('rollback-failed-terminal');
  });

  it('idle execution does not affect canManual/canAuto', () => {
    const r = evaluatePolicy({...baseInput, tier: 'autonomous', executionStatus: 'idle'});
    expect(r.canManual).toBe(true);
    expect(r.canAuto).toBe(true);
    expect(r.canAutonomous).toBe(true);
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/UpdatePolicy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update implementation**

In `src/node/updater/UpdatePolicy.ts`:

```typescript
export interface PolicyInput {
  installMethod: Exclude<InstallMethod, 'auto'>;
  tier: Tier;
  current: string;
  latest: string;
  /** Optional — when known. Only `rollback-failed` materially changes policy. */
  executionStatus?: string;
}

export const evaluatePolicy = ({installMethod, tier, current, latest, executionStatus}: PolicyInput): PolicyResult => {
  if (tier === 'off') {
    return {canNotify: false, canManual: false, canAuto: false, canAutonomous: false, reason: 'tier-off'};
  }
  if (compareSemver(current, latest) >= 0) {
    return {canNotify: false, canManual: false, canAuto: false, canAutonomous: false, reason: 'up-to-date'};
  }
  const canNotify = true;
  const writable = WRITABLE_METHODS.has(installMethod);
  if (!writable) {
    return {canNotify, canManual: false, canAuto: false, canAutonomous: false, reason: 'install-method-not-writable'};
  }
  const terminal = executionStatus === 'rollback-failed';
  return {
    canNotify,
    canManual: tier === 'manual' || tier === 'auto' || tier === 'autonomous',
    canAuto: !terminal && (tier === 'auto' || tier === 'autonomous'),
    canAutonomous: !terminal && tier === 'autonomous',
    reason: terminal ? 'rollback-failed-terminal' : 'ok',
  };
};
```

Also update the `updateStatus.ts` call to pass `executionStatus: state.execution.status`.

- [ ] **Step 4: Run — pass**

Run: `pnpm vitest run src/tests/backend-new/specs/updater/UpdatePolicy.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/UpdatePolicy.ts src/node/hooks/express/updateStatus.ts \
  src/tests/backend-new/specs/updater/UpdatePolicy.test.ts
git commit -m "$(cat <<'EOF'
feat(updater): UpdatePolicy honours rollback-failed terminal state

canAuto/canAutonomous are denied while execution.status === 'rollback-failed';
canManual stays on because an admin clicking Apply *is* the intervention the
terminal state requires. Status endpoint passes execution.status through so
the admin UI sees the right policy result.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Apply / Cancel / Acknowledge / Log endpoints

**Files:**
- Create: `src/node/hooks/express/updateActions.ts`
- Modify: `src/node/hooks/express/admin.ts` if a hook-registration list lives there (none required if hooks loaded via `ep.json` — see step 3)
- Modify: `src/node/updater/ep.json` (or `src/ep.json`) to register the new hook
- Test: `src/tests/backend/specs/updateActions.ts` (mocha integration)

Strict admin auth on all four endpoints (apply, cancel, acknowledge, log) — unlike `/admin/update/status` which is read-only and intentionally loose. POST endpoints require an authenticated `is_admin` session; the GET log endpoint requires the same.

- [ ] **Step 1: Find the right hook registration site**

```bash
grep -nE "updateStatus|updater/index" src/node/utils/Settings.ts src/node/server.ts src/node/hooks src/ep.json src/static/js/pluginfw 2>/dev/null
cat src/ep.json
```

PR 1 registered `updater/index.ts:expressCreateServer` and `hooks/express/updateStatus:expressCreateServer` in `src/ep.json`. Add `hooks/express/updateActions:expressCreateServer` in the same array.

- [ ] **Step 2: Failing test (mocha)**

Create `src/tests/backend/specs/updateActions.ts`:

```typescript
'use strict';

const assert = require('assert').strict;
const common = require('../common');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import settings from '../../../node/utils/Settings';
import {saveState} from '../../../node/updater/state';
import {EMPTY_STATE} from '../../../node/updater/types';
import path from 'node:path';

const statePath = () => path.join(settings.root, 'var', 'update-state.json');
const authHookNames = ['preAuthorize', 'authenticate', 'authorize'];
const failHookNames = ['preAuthzFailure', 'authnFailure', 'authzFailure', 'authFailure'];

const installAdminAuth = () => {
  for (const h of authHookNames.concat(failHookNames)) plugins.hooks[h] = [];
  plugins.hooks.authenticate = [{
    hook_fn: (_n: string, ctx: any, cb: Function) => {
      ctx.req.session.user = {is_admin: true};
      cb([true]);
    },
  }];
  (settings as any).requireAuthentication = true;
  (settings as any).requireAuthorization = false;
  (settings as any).users = {admin: {password: 'admin-pw', is_admin: true}};
};

describe(__filename, function () {
  let agent: any;
  const backups: Record<string, any> = {};

  before(async () => { agent = await common.init(); });

  beforeEach(async () => {
    backups.hooks = {};
    for (const n of authHookNames.concat(failHookNames)) backups.hooks[n] = plugins.hooks[n];
    backups.settings = {};
    for (const k of ['requireAuthentication', 'requireAuthorization', 'users']) backups.settings[k] = (settings as any)[k];
    await saveState(statePath(), {
      ...EMPTY_STATE,
      latest: {version: '99.0.0', tag: 'v99.0.0', body: 'release', publishedAt: '2099-01-01T00:00:00Z', prerelease: false, htmlUrl: 'https://example/'},
    });
  });

  afterEach(() => {
    Object.assign(plugins.hooks, backups.hooks);
    Object.assign(settings, backups.settings);
  });

  describe('POST /admin/update/apply', () => {
    it('rejects unauthenticated', async () => {
      await agent.post('/admin/update/apply').expect(401);
    });

    it('rejects when policy denies (non-git install method)', async () => {
      installAdminAuth();
      const orig = settings.updates.installMethod;
      settings.updates.installMethod = 'docker';
      try {
        await agent.post('/admin/update/apply').auth('admin', 'admin-pw').expect(409);
      } finally { settings.updates.installMethod = orig; }
    });

    it('rejects when an execution is already in flight', async () => {
      installAdminAuth();
      await saveState(statePath(), {
        ...EMPTY_STATE,
        latest: {version: '99.0.0', tag: 'v99.0.0', body: '', publishedAt: '', prerelease: false, htmlUrl: ''},
        execution: {status: 'executing', targetTag: 'v99.0.0', fromSha: 'x', startedAt: '2026-05-08T00:00:00Z'},
      });
      await agent.post('/admin/update/apply').auth('admin', 'admin-pw').expect(409);
    });
  });

  describe('POST /admin/update/cancel', () => {
    it('rejects when nothing is running (409)', async () => {
      installAdminAuth();
      await agent.post('/admin/update/cancel').auth('admin', 'admin-pw').expect(409);
    });
  });

  describe('POST /admin/update/acknowledge', () => {
    it('clears a terminal state to idle', async () => {
      installAdminAuth();
      await saveState(statePath(), {
        ...EMPTY_STATE,
        execution: {status: 'rollback-failed', reason: 'install-failed; rollback failed: pnpm exit 1', targetTag: 'v99.0.0', fromSha: 'x', at: '2026-05-08T00:00:00Z'},
        lastResult: {targetTag: 'v99.0.0', fromSha: 'x', outcome: 'rollback-failed', reason: 'pnpm install failed', at: '2026-05-08T00:00:00Z'},
      });
      await agent.post('/admin/update/acknowledge').auth('admin', 'admin-pw').expect(200);
      const status = await agent.get('/admin/update/status').expect(200);
      assert.equal(status.body.execution.status, 'idle');
    });

    it('refuses to clear a non-terminal state (409)', async () => {
      installAdminAuth();
      await saveState(statePath(), {...EMPTY_STATE});
      await agent.post('/admin/update/acknowledge').auth('admin', 'admin-pw').expect(409);
    });
  });

  describe('GET /admin/update/log', () => {
    it('requires admin auth', async () => {
      await agent.get('/admin/update/log').expect(401);
    });

    it('returns 200 with text body for an admin', async () => {
      installAdminAuth();
      const res = await agent.get('/admin/update/log').auth('admin', 'admin-pw').expect(200);
      assert.equal(typeof res.text, 'string');
    });
  });
});
```

- [ ] **Step 3: Implement the route module**

Create `src/node/hooks/express/updateActions.ts`:

```typescript
'use strict';

import path from 'node:path';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import log4js from 'log4js';
import {ArgsExpressType} from '../../types/ArgsExpressType';
import settings, {getEpVersion} from '../../utils/Settings';
import {getDetectedInstallMethod, stateFilePath, getRollbackDeps} from '../../updater';
import {evaluatePolicy} from '../../updater/UpdatePolicy';
import {loadState, saveState} from '../../updater/state';
import {acquireLock, releaseLock, isHeld} from '../../updater/lock';
import {executeUpdate} from '../../updater/UpdateExecutor';
import {createDrainer} from '../../updater/SessionDrainer';
import {runPreflight} from '../../updater/preflight';
import {verifyReleaseTag} from '../../updater/trustedKeys';
import {tailLines} from '../../updater/updateLog';
import {UpdateState} from '../../updater/types';

const logger = log4js.getLogger('updater');
const lockPath = () => path.join(settings.root, 'var', 'update.lock');
const logPath = () => path.join(settings.root, 'var', 'log', 'update.log');
const backupDir = () => path.join(settings.root, 'var', 'update-backup');

let drainer: ReturnType<typeof createDrainer> | null = null;

const requireAdmin = (req: any, res: any): boolean => {
  const u = req.session?.user;
  if (!u) { res.status(401).send('Authentication required'); return false; }
  if (!u.is_admin) { res.status(403).send('Forbidden'); return false; }
  return true;
};

const wrapAsync = (fn: (req: any, res: any, next: Function) => Promise<unknown>) =>
  (req: any, res: any, next: Function) => Promise.resolve(fn(req, res, next)).catch(next);

const broadcastShout = (key: string, values: Record<string, unknown>): void => {
  // Use the existing shout pipeline via socket.io. PR 1 uses io.sockets.emit('shout', ...).
  // We re-import lazily to dodge a require-cycle with the socketio hook.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {io} = require('../socketio');
    if (!io) return;
    io.sockets.emit('shout', {
      type: 'COLLABROOM',
      data: {type: 'shoutMessage', payload: {message: {message: key, values, sticky: false}, timestamp: Date.now()}},
    });
  } catch (err) {
    logger.warn(`broadcastShout: ${(err as Error).message}`);
  }
};

export const expressCreateServer = (
  _hookName: string,
  {app}: ArgsExpressType,
  cb: Function,
): void => {
  if (settings.updates.tier === 'off') return cb();

  app.post('/admin/update/apply', wrapAsync(async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const state = await loadState(stateFilePath());
    if (!state.latest) return res.status(409).json({error: 'no-known-latest'});
    if (state.execution.status !== 'idle' && state.execution.status !== 'verified' &&
        !state.execution.status.startsWith('rolled-back') && state.execution.status !== 'preflight-failed') {
      return res.status(409).json({error: `execution-busy:${state.execution.status}`});
    }

    const installMethod = getDetectedInstallMethod();
    const policy = evaluatePolicy({
      installMethod, tier: settings.updates.tier,
      current: getEpVersion(), latest: state.latest.version,
      executionStatus: state.execution.status,
    });
    if (!policy.canManual) return res.status(409).json({error: 'policy-denied', reason: policy.reason});

    if (!await acquireLock(lockPath())) return res.status(409).json({error: 'lock-held'});

    try {
      // Preflight
      const targetTag = state.latest.tag;
      const startedAt = new Date().toISOString();
      const preState: UpdateState = {...state, execution: {status: 'preflight', targetTag, startedAt}};
      await saveState(stateFilePath(), preState);

      const pf = await runPreflight(
        {targetTag, diskSpaceMinMB: settings.updates.diskSpaceMinMB,
         requireSignature: settings.updates.requireSignature,
         trustedKeysPath: settings.updates.trustedKeysPath},
        {
          installMethod,
          workingTreeClean: () => new Promise((resolve) => {
            const c = spawn('git', ['status', '--porcelain'], {cwd: settings.root});
            let out = '';
            c.stdout.on('data', (b) => { out += b.toString(); });
            c.on('close', () => resolve(out.trim().length === 0));
          }),
          freeDiskMB: async () => {
            const {statfs} = await import('node:fs/promises');
            try {
              const s = await (statfs as any)(settings.root);
              return Math.floor((s.bavail * s.bsize) / (1024 * 1024));
            } catch { return Number.POSITIVE_INFINITY; } // fall back to "no constraint" if statfs unsupported
          },
          pnpmOnPath: () => new Promise((resolve) => {
            const c = spawn('pnpm', ['--version'], {stdio: 'ignore'});
            c.on('close', (code) => resolve(code === 0));
            c.on('error', () => resolve(false));
          }),
          lockHeld: async () => false, // we just acquired it
          remoteHasTag: (tag) => new Promise((resolve) => {
            const c = spawn('git', ['ls-remote', '--tags', 'origin', tag], {cwd: settings.root, stdio: ['ignore', 'pipe', 'ignore']});
            let out = '';
            c.stdout.on('data', (b) => { out += b.toString(); });
            c.on('close', () => resolve(out.trim().length > 0));
            c.on('error', () => resolve(false));
          }),
          verifyTag: () => verifyReleaseTag({
            tag: targetTag, repoDir: settings.root,
            requireSignature: settings.updates.requireSignature,
            trustedKeysPath: settings.updates.trustedKeysPath,
          }),
        },
      );

      if (!pf.ok) {
        const at = new Date().toISOString();
        await saveState(stateFilePath(), {
          ...preState,
          execution: {status: 'preflight-failed', targetTag, reason: pf.reason, at},
          lastResult: {targetTag, fromSha: '', outcome: 'preflight-failed', reason: pf.reason, at},
        });
        await releaseLock(lockPath());
        return res.status(409).json({error: 'preflight-failed', reason: pf.reason});
      }

      // Drain
      drainer = createDrainer({
        drainSeconds: Number(settings.updates.drainSeconds) || 60,
        broadcast: (key, values) => broadcastShout(key, values),
      });
      const drainEndsAt = new Date(Date.now() + (Number(settings.updates.drainSeconds) || 60) * 1000).toISOString();
      await saveState(stateFilePath(), {
        ...preState,
        execution: {status: 'draining', targetTag, drainEndsAt, startedAt: new Date().toISOString()},
      });

      // Respond before drain completes — UI polls /admin/update/status + /log.
      res.status(202).json({accepted: true, drainEndsAt});

      const drainResult = await drainer.start();
      drainer = null;
      if (drainResult.outcome === 'cancelled') {
        // The /admin/update/cancel handler already wrote state.execution=idle and
        // lastResult=cancelled. Don't overwrite it here — just release the lock
        // and return; the supervisor doesn't need to restart.
        await releaseLock(lockPath());
        return;
      }

      const fresh = await loadState(stateFilePath());
      await executeUpdate({
        repoDir: settings.root,
        backupDir: backupDir(),
        spawnFn: spawn as any,
        readSha: () => new Promise((resolve, reject) => {
          const c = spawn('git', ['rev-parse', 'HEAD'], {cwd: settings.root, stdio: ['ignore', 'pipe', 'ignore']});
          let out = '';
          c.stdout.on('data', (b) => { out += b.toString(); });
          c.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(`git rev-parse exit ${code}`)));
          c.on('error', reject);
        }),
        copyFile: (src, dst) => fs.mkdir(path.dirname(dst), {recursive: true}).then(() => fs.copyFile(src, dst)),
        saveState: (s) => saveState(stateFilePath(), s),
        initialState: fresh,
        targetTag,
        now: () => new Date(),
        exit: (code) => process.exit(code),
      });
      // executeUpdate either calls process.exit(75) (pending-verification) or returns
      // on a failure path. Failure paths are handled by the next process boot via
      // RollbackHandler's pending-verification check + the rolling-back path inside performRollback.
      // If we reach here, the failure path was hit and we need to perform rollback now.
      const afterExec = await loadState(stateFilePath());
      if (afterExec.execution.status === 'rolling-back') {
        const {performRollback} = await import('../../updater/RollbackHandler');
        await performRollback(afterExec, getRollbackDeps());
      }
      await releaseLock(lockPath());
    } catch (err) {
      logger.error(`apply failed: ${(err as Error).stack || err}`);
      try { await releaseLock(lockPath()); } catch {/* noop */}
      if (!res.headersSent) res.status(500).json({error: 'internal'});
    }
  }));

  app.post('/admin/update/cancel', wrapAsync(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const state = await loadState(stateFilePath());
    // Cancel is allowed only during pre-execute states. Once executing begins (lockfile/SHA mutated)
    // we either complete or rollback. Spec section "Error handling" / state machine.
    if (state.execution.status !== 'preflight' && state.execution.status !== 'draining') {
      return res.status(409).json({error: 'not-cancellable', status: state.execution.status});
    }
    if (drainer) drainer.cancel();
    await saveState(stateFilePath(), {...state, execution: {status: 'idle'}, lastResult: {
      targetTag: (state.execution as any).targetTag ?? '',
      fromSha: '',
      outcome: 'cancelled',
      reason: 'admin-cancelled',
      at: new Date().toISOString(),
    }});
    try { await releaseLock(lockPath()); } catch {/* noop */}
    res.json({cancelled: true});
  }));

  app.post('/admin/update/acknowledge', wrapAsync(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const state = await loadState(stateFilePath());
    const terminal = ['rollback-failed', 'preflight-failed', 'rolled-back'];
    if (!terminal.some((t) => state.execution.status === t)) {
      return res.status(409).json({error: 'not-terminal', status: state.execution.status});
    }
    await saveState(stateFilePath(), {...state, execution: {status: 'idle'}, bootCount: 0});
    res.json({acknowledged: true});
  }));

  app.get('/admin/update/log', wrapAsync(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const lines = await tailLines(logPath(), 200);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(lines.join('\n'));
  }));

  // Lock-held probe so isHeld is reachable. Status endpoint already calls this.
  void isHeld;

  cb();
};
```

In `src/ep.json`, add the new hook (find the existing `expressCreateServer` block listing `updateStatus` and append):

```json
{
  "expressCreateServer": [
    "ep_etherpad-lite/node/updater/index",
    "ep_etherpad-lite/node/hooks/express/updateStatus",
    "ep_etherpad-lite/node/hooks/express/updateActions"
  ]
}
```

(Adjust the array structure to match the actual `ep.json` format — likely each hook is a separate object. Verify with `cat src/ep.json` first.)

- [ ] **Step 4: Run — pass**

```bash
pnpm run ts-check
pnpm run test -- --grep updateActions
```

Expected: TS clean, mocha PASS.

- [ ] **Step 5: Commit**

```bash
git add src/node/hooks/express/updateActions.ts src/ep.json src/tests/backend/specs/updateActions.ts
git commit -m "$(cat <<'EOF'
feat(updater): apply / cancel / acknowledge / log endpoints

Strict admin-only POSTs that drive Tier 2's manual-click flow:
- /admin/update/apply: acquire lock, preflight, drain 60s, execute, exit 75
- /admin/update/cancel: cancel a pre-execute state, release lock
- /admin/update/acknowledge: clear terminal states (preflight-failed,
  rolled-back, rollback-failed) back to idle
- /admin/update/log: tail var/log/update.log for the in-progress UI

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Admin UI — Apply / Cancel / Acknowledge buttons

**Files:**
- Modify: `admin/src/pages/UpdatePage.tsx`
- Modify: `admin/src/store/store.ts`
- Modify: `src/locales/en.json`

- [ ] **Step 1: Extend the store**

In `admin/src/store/store.ts`, extend `UpdateStatusPayload`:

```typescript
export type Execution =
  | {status: 'idle'}
  | {status: 'preflight'; targetTag: string; startedAt: string}
  | {status: 'preflight-failed'; targetTag: string; reason: string; at: string}
  | {status: 'draining'; targetTag: string; drainEndsAt: string; startedAt: string}
  | {status: 'executing'; targetTag: string; fromSha: string; startedAt: string}
  | {status: 'pending-verification'; targetTag: string; fromSha: string; deadlineAt: string}
  | {status: 'verified'; targetTag: string; verifiedAt: string}
  | {status: 'rolling-back'; reason: string; targetTag: string; fromSha: string; at: string}
  | {status: 'rolled-back'; reason: string; targetTag: string; restoredSha: string; at: string}
  | {status: 'rollback-failed'; reason: string; targetTag: string; fromSha: string; at: string};

export interface UpdateStatusPayload {
  // ...existing fields...
  execution: Execution;
  lastResult: null | {
    targetTag: string; fromSha: string;
    outcome: 'verified' | 'rolled-back' | 'rollback-failed' | 'preflight-failed' | 'cancelled';
    reason: string | null; at: string;
  };
  lockHeld: boolean;
}
```

Add a log slice:

```typescript
type StoreState = {
  // ...existing...
  updateLog: string;
  setUpdateLog: (log: string) => void;
};
// in create():
updateLog: '',
setUpdateLog: (log) => set({updateLog: log}),
```

- [ ] **Step 2: Replace `UpdatePage.tsx`**

Replace the `return` block of `UpdatePage` so the `ok` path renders Apply/Cancel/Acknowledge per `execution.status`:

```tsx
const apply = async () => {
  await fetch('/admin/update/apply', {method: 'POST', credentials: 'same-origin'});
  // Re-fetch status — server returned 202, the actual transition happened in the background.
  const r = await fetch('/admin/update/status', {credentials: 'same-origin'});
  if (r.ok) setUpdateStatus(await r.json());
};
const cancel = async () => {
  await fetch('/admin/update/cancel', {method: 'POST', credentials: 'same-origin'});
  const r = await fetch('/admin/update/status', {credentials: 'same-origin'});
  if (r.ok) setUpdateStatus(await r.json());
};
const acknowledge = async () => {
  await fetch('/admin/update/acknowledge', {method: 'POST', credentials: 'same-origin'});
  const r = await fetch('/admin/update/status', {credentials: 'same-origin'});
  if (r.ok) setUpdateStatus(await r.json());
};

const status = us.execution.status;
const showApply = us.policy?.canManual && (status === 'idle' || status === 'verified' || status.startsWith('rolled-back') || status === 'preflight-failed') && !us.lockHeld;
const showCancel = status === 'preflight' || status === 'draining';
const showAcknowledge = status === 'preflight-failed' || status === 'rolled-back' || status === 'rollback-failed';

return (
  <div className="update-page">
    <h1><Trans i18nKey="update.page.title"/></h1>
    <dl>
      {/* ...existing dl entries... */}
      <dt><Trans i18nKey="update.page.execution"/></dt>
      <dd>{t(`update.execution.${status}`, {defaultValue: status})}</dd>
    </dl>
    {us.lastResult && (
      <p className={`last-result last-result-${us.lastResult.outcome}`}>
        <Trans i18nKey={`update.page.last_result.${us.lastResult.outcome}`}
          values={{tag: us.lastResult.targetTag, reason: us.lastResult.reason ?? ''}}/>
      </p>
    )}
    {us.policy && !us.policy.canManual && (
      <p className="policy-deny">
        <Trans i18nKey={`update.page.policy.${us.policy.reason}`} defaults={us.policy.reason}/>
      </p>
    )}
    <div className="update-actions">
      {showApply && <button onClick={apply}>{t('update.page.apply')}</button>}
      {showCancel && <button onClick={cancel}>{t('update.page.cancel')}</button>}
      {showAcknowledge && <button onClick={acknowledge}>{t('update.page.acknowledge')}</button>}
    </div>
    {/* changelog block — keep as in PR 1 */}
  </div>
);
```

- [ ] **Step 3: Add the i18n keys**

In `src/locales/en.json`, add:

```json
  "update.page.apply": "Apply update",
  "update.page.cancel": "Cancel",
  "update.page.acknowledge": "Acknowledge",
  "update.page.execution": "Status",
  "update.page.policy.install-method-not-writable": "Updates from the admin UI require a git install. Update via your package manager.",
  "update.page.policy.rollback-failed-terminal": "A previous update failed and could not be rolled back. Manual intervention required; press Acknowledge to clear the lock once the install is healthy.",
  "update.page.policy.up-to-date": "You are running the latest version.",
  "update.page.policy.tier-off": "Updates are disabled (updates.tier = \"off\").",
  "update.page.last_result.verified": "Last update to {{tag}} verified.",
  "update.page.last_result.rolled-back": "Last attempted update to {{tag}} rolled back: {{reason}}.",
  "update.page.last_result.rollback-failed": "Last update attempt failed AND rollback failed: {{reason}}. Manual intervention required.",
  "update.page.last_result.preflight-failed": "Last attempted update to {{tag}} failed preflight: {{reason}}.",
  "update.page.last_result.cancelled": "Last attempted update to {{tag}} cancelled by admin.",
  "update.execution.idle": "Idle",
  "update.execution.preflight": "Pre-flight checks",
  "update.execution.preflight-failed": "Pre-flight failed",
  "update.execution.draining": "Draining sessions",
  "update.execution.executing": "Updating...",
  "update.execution.pending-verification": "Pending verification",
  "update.execution.verified": "Verified",
  "update.execution.rolling-back": "Rolling back",
  "update.execution.rolled-back": "Rolled back",
  "update.execution.rollback-failed": "Rollback failed",
  "update.banner.terminal.rollback-failed": "An update attempt failed and could not be rolled back. Manual intervention required.",
  "update.drain.t60": "Etherpad will restart in 60 seconds to apply an update.",
  "update.drain.t30": "Etherpad will restart in 30 seconds to apply an update.",
  "update.drain.t10": "Etherpad will restart in 10 seconds to apply an update."
```

- [ ] **Step 4: Build the admin UI and visit it locally**

```bash
pnpm install   # ensure admin deps in case anything is missing
pnpm --filter admin run build
pnpm run dev -- --port 9003 &
# In a browser: http://localhost.lan:9003/admin/update — log in as admin
# Verify the Apply button renders when latest version differs from current
kill %1
```

> Don't kill the apply manually after pressing it on a real install — the update will actually run. Use `pnpm run dev` in a disposable worktree if you want to test the full apply path.

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/UpdatePage.tsx admin/src/store/store.ts src/locales/en.json
git commit -m "$(cat <<'EOF'
feat(updater): admin UI Apply/Cancel/Acknowledge buttons

UpdatePage renders the right action set per execution.status, surfaces
lastResult with localised copy, and shows policy denial reasons (e.g.
install-method-not-writable, rollback-failed-terminal). Buttons round-
trip status through /admin/update/status after each action.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Admin UI — log stream view

**Files:**
- Modify: `admin/src/pages/UpdatePage.tsx`

While `execution.status === 'preflight' | 'draining' | 'executing' | 'rolling-back'`, poll `/admin/update/log` once a second and render the tail in a `<pre>`. Stop polling when the status leaves the set.

- [ ] **Step 1: Add the polling effect**

Inside `UpdatePage`, after the existing `useEffect` for `/admin/update/status`, add:

```tsx
const log = useStore((s) => s.updateLog);
const setLog = useStore((s) => s.setUpdateLog);
const inFlight = ['preflight', 'draining', 'executing', 'rolling-back'].includes(us?.execution?.status ?? '');
useEffect(() => {
  if (!inFlight) return;
  let cancelled = false;
  const tick = async () => {
    if (cancelled) return;
    try {
      const r = await fetch('/admin/update/log', {credentials: 'same-origin'});
      if (r.ok) setLog(await r.text());
      // Re-fetch status too so we know when to stop polling.
      const s = await fetch('/admin/update/status', {credentials: 'same-origin'});
      if (s.ok) setUpdateStatus(await s.json());
    } catch {/* noop */}
    if (!cancelled) setTimeout(tick, 1000);
  };
  tick();
  return () => { cancelled = true; };
}, [inFlight, setLog, setUpdateStatus]);
```

In the JSX:

```tsx
{inFlight && (
  <section className="update-log">
    <h2><Trans i18nKey="update.page.log"/></h2>
    <pre style={{whiteSpace: 'pre-wrap', maxHeight: '320px', overflow: 'auto'}}>{log}</pre>
  </section>
)}
```

- [ ] **Step 2: Add i18n key**

In `src/locales/en.json`:

```json
  "update.page.log": "Update log (last 200 lines)"
```

- [ ] **Step 3: Smoke test in a browser**

Same workflow as Task 12 step 4. Trigger an Apply on a git checkout that's safe to update (e.g., a disposable worktree). Watch the log block populate.

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/UpdatePage.tsx src/locales/en.json
git commit -m "$(cat <<'EOF'
feat(updater): admin UI streams update log while update is in flight

While execution.status is preflight/draining/executing/rolling-back the
page polls /admin/update/log + /admin/update/status once a second,
showing the rolling tail and switching off automatically when the run
terminates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Pad-side drain announcement

**Files:**
- Modify: `src/static/js/chat.js` or `src/static/js/pad.js` (whichever handles incoming `shoutMessage`)
- Modify: `src/locales/en.json` (already done in Task 12 — verify keys exist)

`broadcastShout` in Task 11 sends a shoutMessage payload of the form `{message: {message: 'update.drain.t60', values: {seconds: 60}}, ...}`. The pad client renders shouts via the existing chat pipeline. We need that pipeline to look up `payload.message.message` as a translation key when present and substitute `payload.message.values`.

- [ ] **Step 1: Find the shout-rendering site**

```bash
grep -rn "shoutMessage\|payload.message" src/static/js/ | head -20
```

Locate the function that turns the COLLABROOM shoutMessage into chat text. In Etherpad core that lives in `src/static/js/pad.js` or `src/static/js/chat.js` — search for `shoutMessage`.

- [ ] **Step 2: Extend the renderer to handle i18n keys**

Wrap the existing logic so `if (typeof payload.message.message === 'string' && payload.message.message.startsWith('update.drain.'))` is rendered through `html10n.translations` lookup; otherwise fall back to current behaviour. Concrete patch (adapt to actual code):

```javascript
// existing:
//   const text = payload.message.message;
// becomes:
const raw = payload.message.message;
const values = payload.message.values || {};
let text = raw;
if (typeof raw === 'string' && raw.startsWith('update.drain.') && window.html10n && window.html10n.translations) {
  const tpl = window.html10n.translations[raw];
  if (typeof tpl === 'string') {
    text = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? ''));
  }
}
```

(`html10n.get(raw, values)` is the bound API but `window._` is unbound per memory `project_plugin_window_underscore_audit.md` — go through `window.html10n.translations` directly to dodge that bug.)

- [ ] **Step 3: Add a Playwright test**

In `src/tests/frontend-new/specs/`, add a spec that opens a pad, simulates a shout from the admin socket via the existing admin shout test pattern (`grep -rn "shout" src/tests/frontend-new/`) — if no harness exists, skip this Playwright test and rely on the manual smoke step below. **Do not write a fake test.**

- [ ] **Step 4: Manual smoke test**

```bash
pnpm run dev -- --port 9003 &
# Open http://localhost.lan:9003/p/test-drain in one tab
# In another tab, log in to /admin and use the Shout feature to send "update.drain.t60"
# Verify the pad shows "Etherpad will restart in 60 seconds..."
kill %1
```

If the manual test fails — i.e., the pad shows the literal key — adjust the renderer in step 2 until the pad shows the localised string. Per memory `feedback_test_localized_strings`, do not declare done while the literal key shows.

- [ ] **Step 5: Commit**

```bash
git add src/static/js/chat.js src/static/js/pad.js
git commit -m "$(cat <<'EOF'
feat(updater): pad shoutMessage renders update.drain.* via html10n

When the executor's drain phase broadcasts update.drain.t60/t30/t10,
pads render the localised string instead of the bare i18n key. Goes
through html10n.translations directly to dodge the unbound window._
bug documented in project_plugin_window_underscore_audit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Integration test — end-to-end against a tmp git repo

**Files:**
- Create: `src/tests/backend/specs/updater-integration.ts`

This is the highest-value test in the plan: it runs `executeUpdate` against a real tmp git repo, verifying happy path + each rollback variant by stubbing only the steps that would mutate the *current* install (we replace `pnpm install` with a `bash -c 'exit 0'` and similar). The test is deliberately heavy — run it on its own, not in the unit-test loop.

- [ ] **Step 1: Skeleton failing test**

Create `src/tests/backend/specs/updater-integration.ts`:

```typescript
'use strict';

const assert = require('assert').strict;
import {execSync, spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {executeUpdate} from '../../../node/updater/UpdateExecutor';
import {performRollback, checkPendingVerification} from '../../../node/updater/RollbackHandler';
import {EMPTY_STATE} from '../../../node/updater/types';

const sh = (cmd: string, opts: any = {}) => execSync(cmd, {stdio: 'pipe', ...opts}).toString().trim();

const buildTmpRepo = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-it-'));
  sh('git init -b main', {cwd: dir});
  sh('git config user.email test@example.com', {cwd: dir});
  sh('git config user.name test', {cwd: dir});
  await fs.writeFile(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: x\n');
  sh('git add . && git commit -m initial', {cwd: dir});
  sh('git tag v0.0.1', {cwd: dir});
  await fs.writeFile(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: y\n');
  sh('git add . && git commit -m bump', {cwd: dir});
  sh('git tag v0.0.2', {cwd: dir});
  // executor expects an "origin" — point it at the same dir for the ls-remote check.
  sh(`git remote add origin ${dir}`, {cwd: dir});
  return dir;
};

const stubSpawn = (overrides: Record<string, number> = {}) => {
  // Emulate spawn for everything by mapping (cmd, args) -> exit code.
  return ((cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(' ')}`;
    const exit = overrides[key] ?? (cmd === 'pnpm' ? 0 : -1); // -1 means "use real git"
    if (exit === -1) {
      // Real git for this step.
      const real = spawn(cmd, args, {cwd: (overrides as any).__cwd, stdio: ['ignore', 'pipe', 'pipe']});
      return real;
    }
    return {
      stdout: {on: () => {}}, stderr: {on: () => {}},
      on: (e: string, cb: any) => e === 'close' && setImmediate(() => cb(exit)),
    } as any;
  }) as any;
};

describe(__filename, function () {
  this.timeout(20_000);

  it('happy path: executes against tmp repo, lands on pending-verification', async () => {
    const repo = await buildTmpRepo();
    const states: any[] = [];
    let exited: number | null = null;
    const r = await executeUpdate({
      repoDir: repo,
      backupDir: path.join(repo, 'var', 'update-backup'),
      spawnFn: stubSpawn({'pnpm install --frozen-lockfile': 0, 'pnpm run build:ui': 0, __cwd: repo} as any),
      readSha: async () => sh('git rev-parse HEAD', {cwd: repo}),
      copyFile: (s, d) => fs.mkdir(path.dirname(d), {recursive: true}).then(() => fs.copyFile(s, d)),
      saveState: async (s) => { states.push(structuredClone(s)); },
      initialState: structuredClone(EMPTY_STATE),
      targetTag: 'v0.0.2',
      now: () => new Date(),
      exit: (code) => { exited = code; },
    });
    assert.equal(r.outcome, 'pending-verification');
    assert.equal(exited, 75);
    assert.equal(states.at(-1).execution.status, 'pending-verification');
    // Backup file exists.
    await fs.access(path.join(repo, 'var', 'update-backup', 'pnpm-lock.yaml'));
    await fs.rm(repo, {recursive: true, force: true});
  });

  it('install failure rolls back to original SHA', async () => {
    const repo = await buildTmpRepo();
    const original = sh('git rev-parse HEAD', {cwd: repo});
    let exited: number | null = null;
    const states: any[] = [];

    // Phase 1: executor with failing install.
    await executeUpdate({
      repoDir: repo, backupDir: path.join(repo, 'var', 'update-backup'),
      spawnFn: stubSpawn({'pnpm install --frozen-lockfile': 1, __cwd: repo} as any),
      readSha: async () => sh('git rev-parse HEAD', {cwd: repo}),
      copyFile: (s, d) => fs.mkdir(path.dirname(d), {recursive: true}).then(() => fs.copyFile(s, d)),
      saveState: async (s) => { states.push(structuredClone(s)); },
      initialState: structuredClone(EMPTY_STATE),
      targetTag: 'v0.0.2',
      now: () => new Date(),
      exit: (c) => { exited = c; },
    });
    assert.equal(states.at(-1).execution.status, 'rolling-back');

    // Phase 2: rollback.
    await performRollback(states.at(-1), {
      repoDir: repo, backupDir: path.join(repo, 'var', 'update-backup'),
      spawnFn: stubSpawn({'pnpm install --frozen-lockfile': 0, __cwd: repo} as any),
      copyFile: (s, d) => fs.copyFile(s, d),
      saveState: async (s) => { states.push(structuredClone(s)); },
      exit: (c) => { exited = c; },
      now: () => new Date(),
      rollbackHealthCheckSeconds: 60,
    });
    assert.equal(states.at(-1).execution.status, 'rolled-back');
    assert.equal(sh('git rev-parse HEAD', {cwd: repo}), original);
    assert.equal(exited, 75);
    await fs.rm(repo, {recursive: true, force: true});
  });

  // Add: build-failure rollback (same as install-failure but with build:ui exit 1).
  // Add: crash-loop guard (state.bootCount = 3 forces immediate rollback in checkPendingVerification).
});
```

- [ ] **Step 2: Run — confirm fail / pass**

Run: `pnpm run test -- --grep updater-integration`
Expected: PASS for the two scenarios above; if not, debug — typical issues are `git ls-remote --tags` against a self-origin which needs `git push origin v0.0.2` first; add it inside `buildTmpRepo`.

- [ ] **Step 3: Add the build-failure + crash-loop scenarios**

Append:

```typescript
  it('build failure rolls back to original SHA', async () => { /* same as install but spawnFn returns build:ui=1, install=0 */ });

  it('crash-loop guard forces rollback when bootCount > 2', async () => {
    const repo = await buildTmpRepo();
    const original = sh('git rev-parse HEAD', {cwd: repo});
    sh('git checkout v0.0.2', {cwd: repo});
    // pretend we're already on v0.0.2 (post-update boot) and the lockfile backup exists.
    await fs.mkdir(path.join(repo, 'var', 'update-backup'), {recursive: true});
    await fs.copyFile(path.join(repo, 'pnpm-lock.yaml'), path.join(repo, 'var', 'update-backup', 'pnpm-lock.yaml'));
    sh(`git checkout ${original}`, {cwd: repo});
    sh(`cp var/update-backup/pnpm-lock.yaml pnpm-lock.yaml`, {cwd: repo});
    sh('git checkout v0.0.2', {cwd: repo});

    let exited: number | null = null;
    const states: any[] = [];
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {status: 'pending-verification', targetTag: 'v0.0.2', fromSha: original, deadlineAt: '2026-05-08T10:00:00Z'} as const,
      bootCount: 3,
    };
    const r = checkPendingVerification(state, {
      repoDir: repo, backupDir: path.join(repo, 'var', 'update-backup'),
      spawnFn: stubSpawn({'pnpm install --frozen-lockfile': 0, __cwd: repo} as any),
      copyFile: (s, d) => fs.copyFile(s, d),
      saveState: async (s) => { states.push(structuredClone(s)); },
      exit: (c) => { exited = c; },
      now: () => new Date(),
      rollbackHealthCheckSeconds: 60,
    });
    assert.equal(r.armed, false);
    // Wait a tick for the async rollback to finish.
    await new Promise((r) => setImmediate(r));
    assert.equal(states.at(-1).execution.status, 'rolled-back');
    assert.equal(sh('git rev-parse HEAD', {cwd: repo}), original);
    assert.equal(exited, 75);
    await fs.rm(repo, {recursive: true, force: true});
  });
```

- [ ] **Step 4: Run all integration tests**

Run: `pnpm run test -- --grep "updater-integration|updateActions|updateStatus"`
Expected: PASS for everything.

- [ ] **Step 5: Commit**

```bash
git add src/tests/backend/specs/updater-integration.ts
git commit -m "$(cat <<'EOF'
test(updater): integration suite over a tmp git repo

Exercises executeUpdate + performRollback + checkPendingVerification
end-to-end against a disposable git repo with two tagged commits:
happy path -> pending-verification, install-fail rollback, build-fail
rollback, crash-loop bootCount>2 forced rollback. Runs with mocha at
20s timeout; no real pnpm/network.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Playwright spec — admin Apply flow

**Files:**
- Create: `src/tests/frontend-new/admin-spec/update-page-actions.spec.ts`

The Playwright spec stubs the network: it intercepts `/admin/update/status` to seed a fake `latest`, intercepts `/admin/update/apply` to return `202`, and verifies the UI transitions through the right buttons. We do *not* actually run an update — that's covered by the manual smoke runbook.

- [ ] **Step 1: Failing spec**

Create `src/tests/frontend-new/admin-spec/update-page-actions.spec.ts`:

```typescript
import {expect, test} from '@playwright/test';

const baseStatus = {
  currentVersion: '2.7.1',
  latest: {version: '2.7.2', tag: 'v2.7.2', body: 'release notes', publishedAt: '2026-05-01T00:00:00Z', prerelease: false, htmlUrl: 'https://example/'},
  lastCheckAt: '2026-05-08T00:00:00Z',
  installMethod: 'git',
  tier: 'manual',
  policy: {canNotify: true, canManual: true, canAuto: false, canAutonomous: false, reason: 'ok'},
  vulnerableBelow: [],
  execution: {status: 'idle'},
  lastResult: null,
  lockHeld: false,
};

test('admin Apply button posts to /admin/update/apply and re-fetches status', async ({page}) => {
  let posted = false;
  await page.route('**/admin/update/status', (route) => route.fulfill({json: baseStatus}));
  await page.route('**/admin/update/apply', (route) => { posted = true; route.fulfill({status: 202, json: {accepted: true}}); });
  await page.goto('/admin/update');
  await expect(page.getByRole('button', {name: /apply update/i})).toBeVisible();
  await page.getByRole('button', {name: /apply update/i}).click();
  await expect.poll(() => posted).toBe(true);
});

test('install-method-not-writable hides Apply and shows the policy reason', async ({page}) => {
  const denied = {...baseStatus, installMethod: 'docker',
    policy: {canNotify: true, canManual: false, canAuto: false, canAutonomous: false, reason: 'install-method-not-writable'}};
  await page.route('**/admin/update/status', (route) => route.fulfill({json: denied}));
  await page.goto('/admin/update');
  await expect(page.getByRole('button', {name: /apply update/i})).toHaveCount(0);
  await expect(page.getByText(/Updates from the admin UI require a git install/i)).toBeVisible();
});

test('rollback-failed shows Acknowledge button', async ({page}) => {
  const terminal = {...baseStatus,
    execution: {status: 'rollback-failed', reason: 'pnpm install failed; rollback failed: pnpm exit 1', targetTag: 'v2.7.2', fromSha: 'x', at: '2026-05-08T00:00:00Z'},
    lastResult: {targetTag: 'v2.7.2', fromSha: 'x', outcome: 'rollback-failed', reason: 'pnpm install failed', at: '2026-05-08T00:00:00Z'}};
  await page.route('**/admin/update/status', (route) => route.fulfill({json: terminal}));
  await page.goto('/admin/update');
  await expect(page.getByRole('button', {name: /acknowledge/i})).toBeVisible();
});
```

- [ ] **Step 2: Run**

```bash
pnpm run test-ui -- src/tests/frontend-new/admin-spec/update-page-actions.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/tests/frontend-new/admin-spec/update-page-actions.spec.ts
git commit -m "$(cat <<'EOF'
test(updater): Playwright admin Apply flow + policy denial + acknowledge

Stubs /admin/update/status and /admin/update/apply at the route level so
we can assert UI transitions (button visibility, policy-denial copy,
terminal-state acknowledge) without actually running an update.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Banner copy for terminal states

**Files:**
- Modify: `admin/src/components/UpdateBanner.tsx`

When `execution.status === 'rollback-failed'`, the banner text should be the strong `update.banner.terminal.rollback-failed` copy and link to `/update`.

- [ ] **Step 1: Patch the banner**

Replace the JSX so it picks the right key:

```tsx
if (!updateStatus) return null;
const exec = updateStatus.execution?.status;
if (exec === 'rollback-failed') {
  return (
    <div className="update-banner update-banner-terminal" role="alert">
      <strong><Trans i18nKey="update.banner.terminal.rollback-failed"/></strong>{' '}
      <Link to="/update">{t('update.banner.cta')}</Link>
    </div>
  );
}
if (!updateStatus.latest || updateStatus.currentVersion === updateStatus.latest.version) return null;
// existing ok-banner...
```

- [ ] **Step 2: Manual visual test**

Seed the state file (`var/update-state.json`) with `execution.status: 'rollback-failed'` then load `/admin/update`. Confirm the banner copy matches `update.banner.terminal.rollback-failed`, not the literal key. Per memory `feedback_test_localized_strings`, fail the task if the literal key shows.

- [ ] **Step 3: Commit**

```bash
git add admin/src/components/UpdateBanner.tsx
git commit -m "$(cat <<'EOF'
feat(updater): admin banner shows rollback-failed terminal state

When execution.status is rollback-failed, the banner switches to a
role=alert with stronger copy, regardless of whether a new release is
known. Other terminal states (preflight-failed, rolled-back) surface on
the page itself, not the banner — they're informational, not urgent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Documentation + smoke runbook

**Files:**
- Modify: `doc/admin/updates.md`
- Modify: `CHANGELOG.md`
- Create: `docs/superpowers/specs/2026-04-25-auto-update-runbook.md`

The spec's "Phased rollout / PR 2" entry calls out a runbook ("manual smoke runbook in `docs/superpowers/specs/2026-04-25-auto-update-runbook.md`, run before each tier ships, against a disposable VM"). This task ships it alongside the user-facing docs.

- [ ] **Step 0: Write the smoke runbook**

Create `docs/superpowers/specs/2026-04-25-auto-update-runbook.md` covering:

1. Provisioning a disposable Ubuntu/Debian VM with systemd + a checked-out git install.
2. Setting `updates.tier: "manual"` in `settings.json`.
3. Booting under systemd with `Restart=on-failure` + `RestartSec=5` (sample unit file inline).
4. Forcing a downgrade by `git checkout` of the previous tag, restart, confirm Apply button shows.
5. Apply, observe drain broadcasts in a separate pad, observe restart, observe verified state.
6. Forcing rollback: corrupt `pnpm-lock.yaml` between checkout and install (or pin to a tag with a known-broken build), Apply, observe rolled-back state.
7. Forcing rollback-failed: also break the backup lockfile, Apply, observe terminal state and Acknowledge flow.
8. Crash-loop guard: pin a tag whose code throws on boot, Apply, observe bootCount climb to 3 + forced rollback.
9. Sign-off checklist: every observable transition matches `docs/superpowers/specs/2026-04-25-auto-update-design.md` "State machine".

- [ ] **Step 1: Append Tier 2 section to `doc/admin/updates.md`**

Document:
- Activation: `updates.tier: "manual"` requires a `git` install.
- Process supervisor required (systemd/pm2/docker restart-policy) — Etherpad exits 75 to trigger restart.
- Apply flow: button → preflight → 60s drain (broadcasts at T-60/-30/-10) → fetch/checkout/install/build → exit → restart → 60s health check.
- Rollback paths: install/build failure, health-check timeout, crash loop (>2 reboots).
- Terminal states: `preflight-failed` and `rolled-back` are informational; `rollback-failed` requires `POST /admin/update/acknowledge` after manual recovery.
- Settings: each new key with default + when to change.
- Signature verification: opt-in via `requireSignature: true`; document GNUPGHOME path.
- What is *not* covered: Tier 3 (auto) and Tier 4 (autonomous) ship later.

- [ ] **Step 2: Add to `CHANGELOG.md` Unreleased**

```markdown
### Updater
- Tier 2 (manual click): admins can now apply updates from `/admin/update` on git installs. Requires a process supervisor; the executor exits 75 to trigger restart, and the next boot runs a 60s health check that auto-rolls back on failure. Tags are signature-checked when `updates.requireSignature: true`. New settings: `updates.preApplyGraceMinutes`, `drainSeconds`, `rollbackHealthCheckSeconds`, `diskSpaceMinMB`, `requireSignature`, `trustedKeysPath`.
```

- [ ] **Step 3: Commit**

```bash
git add doc/admin/updates.md CHANGELOG.md docs/superpowers/specs/2026-04-25-auto-update-runbook.md
git commit -m "$(cat <<'EOF'
docs(updater): document Tier 2 manual-click flow + smoke runbook

Adds doc/admin/updates.md Tier 2 section: prerequisites (git install +
process supervisor), Apply flow with timings, rollback paths, terminal
states + acknowledge, signature-verification opt-in. Ships the manual
smoke runbook the design spec calls for: disposable VM, systemd unit,
forced rollback / rollback-failed / crash-loop scenarios. Notes Tier 3/4
are deferred to follow-up PRs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Final sanity sweep + open PR

**Files:** none (workflow only).

- [ ] **Step 1: Full type check + tests**

```bash
pnpm run ts-check
pnpm vitest run src/tests/backend-new/specs/updater
pnpm run test -- --grep "updater|updateActions|updateStatus"
pnpm run test-ui -- src/tests/frontend-new/admin-spec/update-page-actions.spec.ts
pnpm --filter admin run build
```

Expected: every step PASS.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/7607-auto-update-tier2-manual-click
```

- [ ] **Step 3: Open PR against `develop`**

```bash
gh pr create --base develop --title "feat(updater): tier 2 — manual-click update from /admin/update (#7607)" --body "$(cat <<'EOF'
## Summary

Ships **Tier 2 (manual click)** of the four-tier auto-update design at
`docs/superpowers/specs/2026-04-25-auto-update-design.md`. Builds on PR #7601
(Tier 1 — notify, merged 2026-05-01).

- Admins on git installs see an **Apply update** button at `/admin/update`.
- Click flow: pre-flight checks → 60s drain (with T-60/-30/-10 pad broadcasts) → `git fetch / checkout / pnpm install --frozen-lockfile / pnpm run build:ui` → exit 75 for the supervisor to restart.
- 60s health-check on the next boot. On crash loop (bootCount > 2) or health-check timeout we restore the prior SHA + lockfile and exit 75 again.
- Terminal `rollback-failed` state surfaces a strong banner; admin clicks **Acknowledge** to clear after manual recovery.
- New settings under `updates.*`: `preApplyGraceMinutes`, `drainSeconds`, `rollbackHealthCheckSeconds`, `diskSpaceMinMB`, `requireSignature`, `trustedKeysPath` (all opt-in / sane defaults).
- Signature verification (`requireSignature`) is opt-in and stub-friendly: false → log warning and pass; true → `git verify-tag <tag>` against the user keyring (or `trustedKeysPath` via `GNUPGHOME`). Etherpad's release process does not yet sign tags consistently — turning on by default would break Tier 2 for everyone, so this is documented as follow-up.

Tier 3 (auto with grace window) and Tier 4 (autonomous within maintenance window) are out of scope for this PR.

## Architecture

- New atomic units under `src/node/updater/`: `lock` (PID file), `trustedKeys` (gpg via git verify-tag), `preflight` (sequenced check pipeline), `UpdateExecutor` (DI-spawn pipeline), `RollbackHandler` (boot health-timer + crash-loop guard), `SessionDrainer` (timed broadcasts + accept-flag), `updateLog` (rolling appender + tail).
- New routes in `src/node/hooks/express/updateActions.ts`: `POST /admin/update/{apply,cancel,acknowledge}`, `GET /admin/update/log` — strict admin auth.
- `RollbackHandler.checkPendingVerification` wires into boot in `src/node/updater/index.ts`; `markBootHealthy` is called from `src/node/server.ts` after state hits `RUNNING`.
- Admin UI: `UpdatePage` renders Apply/Cancel/Acknowledge per `execution.status`, polls `/admin/update/log` while in flight, surfaces lastResult and policy denial copy. Banner adds a terminal-state alert variant.
- Pad UI: existing shoutMessage pipeline learns to render `update.drain.t60/t30/t10` keys via `html10n.translations` (avoids the unbound `window._` bug).

## Test plan

- [x] `pnpm vitest run src/tests/backend-new/specs/updater` — unit suite (lock, preflight, trustedKeys, UpdateExecutor, RollbackHandler, SessionDrainer, updateLog, drainer-handshake, UpdatePolicy, index-boot, state)
- [x] `pnpm run test --grep updateActions` — mocha API tests for the four new endpoints (auth, policy, terminal-state acknowledge)
- [x] `pnpm run test --grep updater-integration` — end-to-end against a tmp git repo: happy path, install-fail rollback, build-fail rollback, crash-loop forced rollback
- [x] `pnpm run test-ui -- src/tests/frontend-new/admin-spec/update-page-actions.spec.ts` — Playwright Apply / policy denial / Acknowledge
- [x] Manual smoke: drain announcement renders the localised string in a real pad
- [x] `pnpm run ts-check` clean, `pnpm --filter admin run build` clean

## Notes

- Process supervisor is a hard requirement for Tier 2. Documented in `doc/admin/updates.md`.
- Tag signature verification is opt-in pending a separate "sign all releases" project. Logged as a warning when skipped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Wait for CI then check, fix anything that breaks**

```bash
sleep 30
gh pr checks --watch
```

If a check fails, pull the log, fix, push. Per memory `feedback_check_ci_after_pr`, do not move on with red CI.

- [ ] **Step 5: Action Qodo review**

Once Qodo posts review comments, fetch and address each per memory `feedback_qodo_pr_feedback`.

```bash
gh pr view --comments | head -200
```

---

## Self-review checklist (run before declaring this plan ready)

- [ ] Every spec section under "Tier 2 — manual click", "Error handling", "Phased rollout / PR 2" has a corresponding task.
- [ ] Type names / function names are consistent across tasks (e.g., `executeUpdate`, `performRollback`, `checkPendingVerification`, `runPreflight`, `acquireLock`/`releaseLock`/`isHeld`, `createDrainer`, `tailLines`, `verifyReleaseTag`).
- [ ] No "TODO" / "TBD" / "similar to above" / "appropriate validation" placeholder steps.
- [ ] Every `bash` snippet runs without further parameter substitution.
- [ ] Every test step shows the actual test code, not "write a test for this".
- [ ] Every `git commit` step lists the exact files to add and a Conventional-Commits message with the project's standard `Co-Authored-By` footer.
- [ ] Tasks 14 and 17 require a manual visual check; that is documented as a hard gate (per memory `feedback_test_localized_strings`).
- [ ] Tier 3 / 4 are explicitly out of scope.
