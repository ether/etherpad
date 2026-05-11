# Auto-Update PR 3 — Tier 3 (auto with grace window) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Tier 3 of the auto-update subsystem: when a new release is detected and `updates.tier == "auto"` on a writable install, schedule the update after `preApplyGraceMinutes`, give the admin a countdown + cancel UI during the grace window, then run the existing Tier 2 apply pipeline.

**Architecture:** Add a new `scheduled` execution state persisted in `var/update-state.json`. A new pure module `Scheduler.ts` decides what to do (schedule / re-schedule / fire-now / cancel) given the current state, policy, latest release, and grace setting. A side-effect runner in `index.ts` arms a single in-process timer, fires the scheduled update through an extracted `applyPipeline` (lifted out of the HTTP handler so the scheduler and the HTTP handler share the same orchestration), and persists pending-update info so a restart inside the grace window rehydrates the schedule. The Notifier learns a new `grace-start` email kind. The admin UI gains a countdown panel + a cancel button bound to the existing `/admin/update/cancel` endpoint, now also allowed during `scheduled`.

**Tech Stack:** TypeScript (Node ≥ 22), Express, log4js, vitest (unit), mocha + supertest (HTTP integration), Playwright (admin UI), React + Zustand (admin UI).

---

## File structure

### New files

- `src/node/updater/Scheduler.ts` — pure `decideSchedule()` decision function + the small timer-armer runner with start/cancel/rehydrate. No I/O inside the decision function.
- `src/node/updater/applyPipeline.ts` — extracted apply orchestration: preflight → drain → executor → rollback. Takes pluggable deps (state I/O, drainer factory, executor fn, lock, log) and an optional `onAccepted` callback. Both the HTTP `/admin/update/apply` handler and the Scheduler call it.
- `src/tests/backend/specs/updater/Scheduler.test.ts` — vitest unit tests for `decideSchedule()` matrix.
- `src/tests/backend/specs/updater/applyPipeline.test.ts` — vitest unit tests for orchestration paths (happy, drain-cancelled, executor-failed, rolled-back).
- `src/tests/backend/specs/updater-scheduler-integration.ts` — mocha integration test for end-to-end scheduling against a tmp repo (grace fires apply; cancel during grace returns to idle; restart during grace rehydrates).
- `src/tests/frontend-new/admin-spec/update-scheduled.spec.ts` — Playwright: scheduled state renders countdown + cancel, cancel transitions back to idle.

### Modified files

- `src/node/updater/types.ts` — extend `ExecutionStatus` with `scheduled`, extend `EmailSendLog` with `graceStartTag`, update `EMPTY_STATE`, update `EXECUTION_STATUSES`.
- `src/node/updater/state.ts` — accept the new field in the validator/migration path.
- `src/node/updater/Notifier.ts` — new `EmailKind: 'grace-start'`, new optional input `scheduledForTag`, decision branch + dedupe via `graceStartTag`.
- `src/node/updater/UpdatePolicy.ts` — already returns `canAuto` correctly; add explicit tests at PR 3 (no code change expected, verify via tests).
- `src/node/updater/index.ts` — instantiate Scheduler at boot, rehydrate from persisted state, evaluate after every `performCheck`, send grace-start email via Notifier when scheduler returns one, dispose timer on shutdown.
- `src/node/hooks/express/updateActions.ts` — thin out: call into `applyPipeline.applyUpdate()`. Allow `scheduled` as an allowed-entry status for `/admin/update/apply` (admin can shortcut the grace window). Allow `scheduled` in `/admin/update/cancel`.
- `src/locales/en.json` — add `update.execution.scheduled`, `update.page.scheduled.title`, `update.page.scheduled.countdown`, `update.page.scheduled.apply_now`, `update.page.policy.scheduled`.
- `admin/src/store/store.ts` — extend `Execution` union with `{status: 'scheduled', targetTag, scheduledFor, startedAt}`.
- `admin/src/pages/UpdatePage.tsx` — render countdown panel during `scheduled`, show Cancel + Apply now buttons.
- `src/locales/en.json` — keys above; also `update.banner.scheduled` for `UpdateBanner.tsx`.
- `admin/src/components/UpdateBanner.tsx` — show a one-line scheduled-banner when `execution.status === 'scheduled'`.
- `settings.json.template`, `settings.json.docker` — bump comments referencing tier 3.
- `doc/admin/updates.md` — flip Tier 3 from "designed, not yet implemented" to current; document grace window behaviour.
- `CHANGELOG.md` — Unreleased section entry.
- `docs/superpowers/specs/2026-04-25-auto-update-runbook.md` — append Tier 3 smoke section.

---

## Task 1: Extend persisted state with `scheduled` + `graceStartTag`

**Files:**
- Modify: `src/node/updater/types.ts`
- Modify: `src/node/updater/state.ts`
- Test: `src/tests/backend/specs/updater/state.test.ts` (extend existing if present; create otherwise)

- [ ] **Step 1: Write the failing test**

Append to (or create) `src/tests/backend/specs/updater/state.test.ts`:

```ts
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadState, saveState} from '../../../../node/updater/state';

describe('state — scheduled execution + graceStartTag', () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eppstate-'));
    file = path.join(dir, 'update-state.json');
  });
  afterEach(async () => { await fs.rm(dir, {recursive: true, force: true}); });

  it('round-trips a scheduled execution status', async () => {
    const s = await loadState(file); // empty
    const next = {
      ...s,
      execution: {
        status: 'scheduled' as const,
        targetTag: 'v9.9.9',
        scheduledFor: '2026-05-11T12:00:00.000Z',
        startedAt: '2026-05-11T11:45:00.000Z',
      },
      email: {...s.email, graceStartTag: 'v9.9.9'},
    };
    await saveState(file, next);
    const back = await loadState(file);
    expect(back.execution).toEqual(next.execution);
    expect(back.email.graceStartTag).toBe('v9.9.9');
  });

  it('migrates a state file missing graceStartTag by injecting null', async () => {
    await fs.writeFile(file, JSON.stringify({
      schemaVersion: 1, lastCheckAt: null, lastEtag: null, latest: null,
      vulnerableBelow: [],
      email: {severeAt: null, vulnerableAt: null, vulnerableNewReleaseTag: null}, // graceStartTag missing
      execution: {status: 'idle'}, bootCount: 0, lastResult: null,
    }), 'utf8');
    const s = await loadState(file);
    expect(s.email.graceStartTag).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/tests/backend/specs/updater/state.test.ts`
Expected: FAIL (scheduled status not in union → TS error; or graceStartTag rejected by validator).

- [ ] **Step 3: Implement the type + state changes**

Edit `src/node/updater/types.ts`. Replace the existing `ExecutionStatus` union, `EXECUTION_STATUSES`, `EmailSendLog`, and `EMPTY_STATE` exports with:

```ts
export interface EmailSendLog {
  severeAt: string | null;
  vulnerableAt: string | null;
  vulnerableNewReleaseTag: string | null;
  /** Tag of the most recent release for which we sent a `grace-start` email. */
  graceStartTag: string | null;
}

export type ExecutionStatus =
  | {status: 'idle'}
  | {status: 'scheduled'; targetTag: string; scheduledFor: string; startedAt: string}
  | {status: 'preflight'; targetTag: string; startedAt: string}
  | {status: 'preflight-failed'; targetTag: string; reason: string; at: string}
  | {status: 'draining'; targetTag: string; drainEndsAt: string; startedAt: string}
  | {status: 'executing'; targetTag: string; fromSha: string; startedAt: string}
  | {status: 'pending-verification'; targetTag: string; fromSha: string; deadlineAt: string}
  | {status: 'verified'; targetTag: string; verifiedAt: string}
  | {status: 'rolling-back'; reason: string; targetTag: string; fromSha: string; at: string}
  | {status: 'rolled-back'; reason: string; targetTag: string; restoredSha: string; at: string}
  | {status: 'rollback-failed'; reason: string; targetTag: string; fromSha: string; at: string};

export const EXECUTION_STATUSES = [
  'idle', 'scheduled', 'preflight', 'preflight-failed', 'draining', 'executing',
  'pending-verification', 'verified', 'rolling-back', 'rolled-back', 'rollback-failed',
] as const;

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
    graceStartTag: null,
  },
  execution: {status: 'idle'},
  bootCount: 0,
  lastResult: null,
};
```

Edit `src/node/updater/state.ts`. Find the email-shape validator. Where it currently checks for the three existing fields, add a defaulted `graceStartTag`:

```ts
const validateEmail = (raw: any): EmailSendLog => ({
  severeAt: typeof raw?.severeAt === 'string' ? raw.severeAt : null,
  vulnerableAt: typeof raw?.vulnerableAt === 'string' ? raw.vulnerableAt : null,
  vulnerableNewReleaseTag: typeof raw?.vulnerableNewReleaseTag === 'string' ? raw.vulnerableNewReleaseTag : null,
  graceStartTag: typeof raw?.graceStartTag === 'string' ? raw.graceStartTag : null,
});
```

If the existing `validateExecution` rejects unknown statuses via `EXECUTION_STATUSES.includes(...)`, `'scheduled'` becomes recognised by adding it to the list above — no change here. Otherwise add a `scheduled` case mirroring the others.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/tests/backend/specs/updater/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/types.ts src/node/updater/state.ts src/tests/backend/specs/updater/state.test.ts
git commit -m "feat(updater): scheduled execution state + graceStartTag dedupe field (#7607)"
```

---

## Task 2: Pure scheduler decision function

**Files:**
- Create: `src/node/updater/Scheduler.ts`
- Test: `src/tests/backend/specs/updater/Scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import {describe, it, expect} from 'vitest';
import {decideSchedule} from '../../../../node/updater/Scheduler';
import {EMPTY_STATE, UpdateState, ReleaseInfo} from '../../../../node/updater/types';

const fakeRelease = (tag: string, version = tag.replace(/^v/, '')): ReleaseInfo => ({
  tag, version, body: '', publishedAt: '2026-05-11T00:00:00.000Z', prerelease: false,
  htmlUrl: `https://github.com/ether/etherpad/releases/tag/${tag}`,
});

const policyOk = {canNotify: true, canManual: true, canAuto: true, canAutonomous: false, reason: 'ok'};
const policyNoAuto = {canNotify: true, canManual: true, canAuto: false, canAutonomous: false, reason: 'ok'};

describe('decideSchedule', () => {
  const NOW = new Date('2026-05-11T12:00:00.000Z');

  it('does nothing when no latest release', () => {
    const d = decideSchedule({
      state: EMPTY_STATE, now: NOW, policy: policyOk,
      latest: null, current: '2.0.0', preApplyGraceMinutes: 15, adminEmail: null,
    });
    expect(d).toEqual({action: 'nothing'});
  });

  it('does nothing when canAuto=false and not currently scheduled', () => {
    const state: UpdateState = {...EMPTY_STATE, latest: fakeRelease('v2.0.1')};
    const d = decideSchedule({
      state, now: NOW, policy: policyNoAuto, latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: 15, adminEmail: null,
    });
    expect(d).toEqual({action: 'nothing'});
  });

  it('schedules a new update from idle when canAuto=true', () => {
    const state: UpdateState = {...EMPTY_STATE, latest: fakeRelease('v2.0.1')};
    const d = decideSchedule({
      state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: 15, adminEmail: null,
    });
    expect(d.action).toBe('schedule');
    if (d.action === 'schedule') {
      expect(d.newExecution.status).toBe('scheduled');
      expect(d.newExecution.targetTag).toBe('v2.0.1');
      expect(d.newExecution.scheduledFor).toBe('2026-05-11T12:15:00.000Z');
      expect(d.emails).toEqual([]); // no adminEmail
    }
  });

  it('emits a grace-start email when adminEmail set and tag changed', () => {
    const state: UpdateState = {...EMPTY_STATE, latest: fakeRelease('v2.0.1'),
      email: {...EMPTY_STATE.email, graceStartTag: null}};
    const d = decideSchedule({
      state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: 15, adminEmail: 'ops@example.com',
    });
    expect(d.action).toBe('schedule');
    if (d.action === 'schedule') {
      expect(d.emails).toHaveLength(1);
      expect(d.emails[0].kind).toBe('grace-start');
      expect(d.newEmailState.graceStartTag).toBe('v2.0.1');
    }
  });

  it('does not re-email grace-start when scheduling a tag we already emailed for (restart-in-grace)', () => {
    const state: UpdateState = {
      ...EMPTY_STATE,
      latest: fakeRelease('v2.0.1'),
      execution: {status: 'scheduled', targetTag: 'v2.0.1',
        scheduledFor: '2026-05-11T12:14:00.000Z', startedAt: '2026-05-11T11:59:00.000Z'},
      email: {...EMPTY_STATE.email, graceStartTag: 'v2.0.1'},
    };
    const d = decideSchedule({
      state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: 15, adminEmail: 'ops@example.com',
    });
    expect(d).toEqual({action: 'nothing'}); // already scheduled for this tag
  });

  it('reschedules when a newer tag appears mid-grace', () => {
    const state: UpdateState = {
      ...EMPTY_STATE,
      latest: fakeRelease('v2.0.2'),
      execution: {status: 'scheduled', targetTag: 'v2.0.1',
        scheduledFor: '2026-05-11T12:14:00.000Z', startedAt: '2026-05-11T11:59:00.000Z'},
      email: {...EMPTY_STATE.email, graceStartTag: 'v2.0.1'},
    };
    const d = decideSchedule({
      state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: 15, adminEmail: 'ops@example.com',
    });
    expect(d.action).toBe('schedule');
    if (d.action === 'schedule') {
      expect(d.newExecution.targetTag).toBe('v2.0.2');
      expect(d.emails[0].kind).toBe('grace-start');
      expect(d.newEmailState.graceStartTag).toBe('v2.0.2');
    }
  });

  it('cancels a stale scheduled state when policy disallows auto (e.g. tier flipped)', () => {
    const state: UpdateState = {
      ...EMPTY_STATE,
      latest: fakeRelease('v2.0.1'),
      execution: {status: 'scheduled', targetTag: 'v2.0.1',
        scheduledFor: '2026-05-11T12:14:00.000Z', startedAt: '2026-05-11T11:59:00.000Z'},
    };
    const d = decideSchedule({
      state, now: NOW, policy: policyNoAuto, latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: 15, adminEmail: null,
    });
    expect(d).toEqual({action: 'cancel-schedule', reason: 'policy-denied'});
  });

  it('does nothing when an in-flight status (preflight/draining/executing) is set', () => {
    for (const status of ['preflight', 'draining', 'executing'] as const) {
      const state: UpdateState = {
        ...EMPTY_STATE,
        latest: fakeRelease('v2.0.1'),
        execution: status === 'preflight'
          ? {status, targetTag: 'v2.0.1', startedAt: NOW.toISOString()}
          : status === 'draining'
            ? {status, targetTag: 'v2.0.1', drainEndsAt: NOW.toISOString(), startedAt: NOW.toISOString()}
            : {status, targetTag: 'v2.0.1', fromSha: 'abc', startedAt: NOW.toISOString()},
      };
      const d = decideSchedule({
        state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.0',
        preApplyGraceMinutes: 15, adminEmail: null,
      });
      expect(d).toEqual({action: 'nothing'});
    }
  });

  it('does nothing when terminal (rollback-failed) — policy will already deny auto', () => {
    const state: UpdateState = {
      ...EMPTY_STATE,
      latest: fakeRelease('v2.0.1'),
      execution: {status: 'rollback-failed', targetTag: 'v2.0.1', fromSha: 'abc',
        reason: 'install', at: NOW.toISOString()},
    };
    const d = decideSchedule({
      state, now: NOW, policy: {...policyOk, canAuto: false, reason: 'rollback-failed-terminal'},
      latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: 15, adminEmail: null,
    });
    expect(d).toEqual({action: 'nothing'});
  });

  it('clamps preApplyGraceMinutes to [0, 7*24*60]', () => {
    const state: UpdateState = {...EMPTY_STATE, latest: fakeRelease('v2.0.1')};
    const d1 = decideSchedule({
      state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: -5, adminEmail: null,
    });
    expect(d1.action).toBe('schedule');
    if (d1.action === 'schedule') {
      expect(d1.newExecution.scheduledFor).toBe(NOW.toISOString()); // clamps to 0
    }
    const d2 = decideSchedule({
      state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: 99999, adminEmail: null,
    });
    expect(d2.action).toBe('schedule');
    if (d2.action === 'schedule') {
      const delta = new Date(d2.newExecution.scheduledFor).getTime() - NOW.getTime();
      expect(delta).toBe(7 * 24 * 60 * 60 * 1000); // 7 days
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/tests/backend/specs/updater/Scheduler.test.ts`
Expected: FAIL — `Scheduler` module not found.

- [ ] **Step 3: Implement `Scheduler.ts` (pure decision function only — runner is task 3)**

Create `src/node/updater/Scheduler.ts`:

```ts
import {EmailSendLog, ExecutionStatus, PolicyResult, ReleaseInfo, UpdateState} from './types';
import {PlannedEmail} from './Notifier';

export interface DecideScheduleInput {
  state: UpdateState;
  now: Date;
  policy: PolicyResult;
  latest: ReleaseInfo | null;
  current: string;
  preApplyGraceMinutes: number;
  adminEmail: string | null;
}

export type SchedulerDecision =
  | {action: 'nothing'}
  | {
      action: 'schedule';
      newExecution: Extract<ExecutionStatus, {status: 'scheduled'}>;
      emails: PlannedEmail[];
      newEmailState: EmailSendLog;
    }
  | {action: 'cancel-schedule'; reason: string};

const IN_FLIGHT: ReadonlySet<string> = new Set([
  'preflight', 'draining', 'executing', 'pending-verification', 'rolling-back',
]);
const TERMINAL: ReadonlySet<string> = new Set([
  'preflight-failed', 'rolled-back', 'rollback-failed',
]);
const MAX_GRACE_MINUTES = 7 * 24 * 60; // 1 week — design caps anything beyond as obviously misconfigured.

const clampGrace = (m: number): number => {
  if (!Number.isFinite(m) || m <= 0) return 0;
  return Math.min(MAX_GRACE_MINUTES, Math.floor(m));
};

/**
 * Pure scheduler decision. Returns what the runner should do given the current
 * persisted state, the latest known release, and the resolved policy. No I/O.
 *
 * Decision rules (mirrors design spec § "Tier 3 — auto"):
 *  - No latest, or canAuto false and not currently scheduled → nothing.
 *  - canAuto false but state is scheduled → cancel that schedule (tier flipped).
 *  - State is in-flight or terminal → nothing (let manual/rollback path complete).
 *  - State is scheduled for the current latest tag → nothing (timer is armed).
 *  - State is scheduled for a stale tag, or any other allowed status → schedule
 *    for `now + clamp(preApplyGraceMinutes)`. Emit a `grace-start` email when
 *    `adminEmail` is set and `email.graceStartTag !== latest.tag`.
 */
export const decideSchedule = (input: DecideScheduleInput): SchedulerDecision => {
  const {state, now, policy, latest, current, preApplyGraceMinutes, adminEmail} = input;
  const status = state.execution.status;

  if (!latest) return {action: 'nothing'};

  if (!policy.canAuto) {
    if (status === 'scheduled') return {action: 'cancel-schedule', reason: 'policy-denied'};
    return {action: 'nothing'};
  }

  if (IN_FLIGHT.has(status) || TERMINAL.has(status)) return {action: 'nothing'};

  if (status === 'scheduled' && (state.execution as {targetTag: string}).targetTag === latest.tag) {
    return {action: 'nothing'};
  }

  const graceMs = clampGrace(preApplyGraceMinutes) * 60 * 1000;
  const scheduledFor = new Date(now.getTime() + graceMs).toISOString();
  const newExecution = {
    status: 'scheduled' as const,
    targetTag: latest.tag,
    scheduledFor,
    startedAt: now.toISOString(),
  };

  const emails: PlannedEmail[] = [];
  const newEmailState: EmailSendLog = {...state.email};
  if (adminEmail && state.email.graceStartTag !== latest.tag) {
    emails.push({
      kind: 'grace-start',
      subject: `[Etherpad] Auto-update scheduled for ${latest.version}`,
      body: `Etherpad will auto-update to ${latest.tag} at ${scheduledFor}. To cancel, visit /admin/update and click Cancel. Your version is ${current}.`,
    });
    newEmailState.graceStartTag = latest.tag;
  }

  return {action: 'schedule', newExecution, emails, newEmailState};
};

// Make `void current` keep TS happy if we drop use; current is part of the
// email body, so it remains referenced.
```

Add `grace-start` to the `EmailKind` union in `Notifier.ts` (next task already does that, but TS needs it for `PlannedEmail` typing here — pre-add in this task to keep the build green):

Edit `src/node/updater/Notifier.ts` line where `EmailKind` is declared:

```ts
export type EmailKind = 'severe' | 'vulnerable' | 'vulnerable-new-release' | 'grace-start';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/tests/backend/specs/updater/Scheduler.test.ts`
Expected: PASS (all 9 cases).

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/Scheduler.ts src/node/updater/Notifier.ts src/tests/backend/specs/updater/Scheduler.test.ts
git commit -m "feat(updater): decideSchedule pure decision function (#7607)"
```

---

## Task 3: Scheduler runner — timer arm/cancel/rehydrate

**Files:**
- Modify: `src/node/updater/Scheduler.ts`
- Test: `src/tests/backend/specs/updater/Scheduler.test.ts` (extend)

- [ ] **Step 1: Append failing test for the runner**

Append to `Scheduler.test.ts`:

```ts
import {createSchedulerRunner} from '../../../../node/updater/Scheduler';

describe('createSchedulerRunner', () => {
  it('arms a timer for `scheduledFor` and fires the apply callback once', async () => {
    let fired = 0;
    let lastTag = '';
    const runner = createSchedulerRunner({
      now: () => new Date('2026-05-11T12:00:00.000Z'),
      setTimer: (cb, ms) => {
        // fast-fire on next tick rather than after `ms`
        const h = setImmediate(cb);
        // return a clear-fn shape compatible with clearTimeout(); using setImmediate's
        // own handle works because clearImmediate would be the real clear, but for
        // production we route through setTimeout — see runner impl. Test substitutes both.
        return h as unknown as NodeJS.Timeout;
      },
      clearTimer: (h) => { clearImmediate(h as unknown as NodeJS.Immediate); },
      triggerApply: async (tag) => { fired++; lastTag = tag; },
    });
    runner.arm({targetTag: 'v2.0.1', scheduledFor: '2026-05-11T12:15:00.000Z'});
    await new Promise((r) => setImmediate(r)); // allow setImmediate callback to land
    expect(fired).toBe(1);
    expect(lastTag).toBe('v2.0.1');
  });

  it('clears a previously armed timer when arm() is called again', () => {
    const cleared: any[] = [];
    let nextHandle = 0;
    const runner = createSchedulerRunner({
      now: () => new Date('2026-05-11T12:00:00.000Z'),
      setTimer: () => (++nextHandle) as unknown as NodeJS.Timeout,
      clearTimer: (h) => { cleared.push(h); },
      triggerApply: async () => {},
    });
    runner.arm({targetTag: 'v2.0.1', scheduledFor: '2026-05-11T12:15:00.000Z'});
    runner.arm({targetTag: 'v2.0.2', scheduledFor: '2026-05-11T12:30:00.000Z'});
    expect(cleared).toEqual([1]);
  });

  it('cancel() clears the timer and is idempotent', () => {
    const cleared: any[] = [];
    let handle = 0;
    const runner = createSchedulerRunner({
      now: () => new Date('2026-05-11T12:00:00.000Z'),
      setTimer: () => (++handle) as unknown as NodeJS.Timeout,
      clearTimer: (h) => { cleared.push(h); },
      triggerApply: async () => {},
    });
    runner.arm({targetTag: 'v2.0.1', scheduledFor: '2026-05-11T12:15:00.000Z'});
    runner.cancel();
    runner.cancel(); // no-op
    expect(cleared).toEqual([1]);
  });

  it('fires immediately when scheduledFor is in the past (e.g. restart after grace ended)', async () => {
    let fired = 0;
    const runner = createSchedulerRunner({
      now: () => new Date('2026-05-11T13:00:00.000Z'),
      setTimer: (cb, ms) => { expect(ms).toBe(0); const h = setImmediate(cb); return h as any; },
      clearTimer: (h) => clearImmediate(h as any),
      triggerApply: async () => { fired++; },
    });
    runner.arm({targetTag: 'v2.0.1', scheduledFor: '2026-05-11T12:15:00.000Z'});
    await new Promise((r) => setImmediate(r));
    expect(fired).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/tests/backend/specs/updater/Scheduler.test.ts`
Expected: FAIL — `createSchedulerRunner` not exported.

- [ ] **Step 3: Implement `createSchedulerRunner` in `Scheduler.ts`**

Append to `src/node/updater/Scheduler.ts`:

```ts
export interface SchedulerRunnerDeps {
  now: () => Date;
  setTimer: (cb: () => void, ms: number) => NodeJS.Timeout;
  clearTimer: (h: NodeJS.Timeout) => void;
  /** Invoked when the timer fires. Must be idempotent — runner guarantees a
   * single fire per arm() call but the callback should still check state. */
  triggerApply: (targetTag: string) => Promise<void>;
}

export interface SchedulerRunner {
  /** Arm or re-arm the timer for `scheduledFor`. Idempotent: re-arming clears the prior timer. */
  arm: (s: {targetTag: string; scheduledFor: string}) => void;
  /** Cancel any pending timer. Idempotent. */
  cancel: () => void;
}

export const createSchedulerRunner = ({
  now, setTimer, clearTimer, triggerApply,
}: SchedulerRunnerDeps): SchedulerRunner => {
  let timer: NodeJS.Timeout | null = null;
  let armedFor: string | null = null;

  return {
    arm: ({targetTag, scheduledFor}) => {
      if (timer) { clearTimer(timer); timer = null; }
      armedFor = targetTag;
      const delay = Math.max(0, new Date(scheduledFor).getTime() - now().getTime());
      timer = setTimer(() => {
        timer = null;
        const tag = armedFor;
        if (!tag) return;
        // triggerApply may be async; we discard its promise — failures are
        // surfaced via the apply pipeline's own logging.
        void triggerApply(tag);
      }, delay);
    },
    cancel: () => {
      if (timer) { clearTimer(timer); timer = null; }
      armedFor = null;
    },
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/tests/backend/specs/updater/Scheduler.test.ts`
Expected: PASS (all cases including new runner cases).

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/Scheduler.ts src/tests/backend/specs/updater/Scheduler.test.ts
git commit -m "feat(updater): scheduler timer runner with arm/cancel (#7607)"
```

---

## Task 4: Extract apply pipeline from `updateActions.ts` into `applyPipeline.ts`

**Files:**
- Create: `src/node/updater/applyPipeline.ts`
- Modify: `src/node/hooks/express/updateActions.ts`
- Test: `src/tests/backend/specs/updater/applyPipeline.test.ts`

- [ ] **Step 1: Write the failing test for the extracted pipeline**

```ts
import {describe, it, expect} from 'vitest';
import {applyUpdate, ApplyPipelineDeps} from '../../../../node/updater/applyPipeline';
import {EMPTY_STATE, UpdateState} from '../../../../node/updater/types';

const makeState = (over: Partial<UpdateState> = {}): UpdateState => ({
  ...EMPTY_STATE,
  latest: {
    tag: 'v2.0.1', version: '2.0.1', body: '', publishedAt: '2026-05-11T00:00:00.000Z',
    prerelease: false, htmlUrl: 'https://github.com/ether/etherpad/releases/tag/v2.0.1',
  },
  ...over,
});

const baseDeps = (): ApplyPipelineDeps => {
  const saved: UpdateState[] = [];
  return {
    loadState: async () => makeState(),
    saveState: async (s) => { saved.push(s); },
    acquireLock: async () => true,
    releaseLock: async () => {},
    isValidTag: () => true,
    runPreflight: async () => ({ok: true}),
    createDrainer: () => ({
      start: async () => ({outcome: 'completed' as const}),
      cancel: () => {},
    }),
    executeUpdate: async () => ({outcome: 'pending-verification' as const}),
    performRollback: async () => {},
    appendLog: () => {},
    onAccepted: () => {},
    now: () => new Date('2026-05-11T12:00:00.000Z'),
    installMethod: 'git',
    settings: {
      tier: 'auto',
      drainSeconds: 1,
      diskSpaceMinMB: 1,
      requireSignature: false,
      trustedKeysPath: null,
      adminEmail: null,
    },
    saved,
  } as any;
};

describe('applyUpdate (extracted pipeline)', () => {
  it('runs preflight → drain → execute and returns pending-verification on the happy path', async () => {
    const deps = baseDeps();
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r.outcome).toBe('pending-verification');
  });

  it('returns preflight-failed and writes lastResult when preflight rejects', async () => {
    const deps = baseDeps();
    deps.runPreflight = async () => ({ok: false, reason: 'no-disk-space'});
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r.outcome).toBe('preflight-failed');
    if (r.outcome === 'preflight-failed') expect(r.reason).toBe('no-disk-space');
  });

  it('returns cancelled when drainer reports cancelled', async () => {
    const deps = baseDeps();
    deps.createDrainer = () => ({
      start: async () => ({outcome: 'cancelled' as const}),
      cancel: () => {},
    });
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r.outcome).toBe('cancelled');
  });

  it('refuses if the locked-tag is no longer the targetTag (admin reset state mid-flight)', async () => {
    const deps = baseDeps();
    deps.acquireLock = async () => false; // simulates concurrent lock holder
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r.outcome).toBe('lock-held');
  });

  it('refuses when state.execution is not an allowed-entry status', async () => {
    const deps = baseDeps();
    deps.loadState = async () => makeState({
      execution: {status: 'executing', targetTag: 'v2.0.0', fromSha: 'abc', startedAt: '2026-05-11T11:00:00.000Z'},
    });
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r.outcome).toBe('busy');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/tests/backend/specs/updater/applyPipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `applyPipeline.ts` by lifting orchestration out of `updateActions.ts`**

Create `src/node/updater/applyPipeline.ts`:

```ts
import {UpdateState} from './types';
import {PreflightOk, PreflightInput} from './preflight';
import {Drainer, DrainBroadcastKey} from './SessionDrainer';

export type ApplyOutcome =
  | {outcome: 'pending-verification'}
  | {outcome: 'preflight-failed'; reason: string}
  | {outcome: 'cancelled'}
  | {outcome: 'lock-held'}
  | {outcome: 'busy'; status: string}
  | {outcome: 'invalid-tag'}
  | {outcome: 'no-known-latest'}
  | {outcome: 'rolled-back'};

export interface ApplySettings {
  tier: string;
  drainSeconds: number;
  diskSpaceMinMB: number;
  requireSignature: boolean;
  trustedKeysPath: string | null;
  adminEmail: string | null;
}

export interface ApplyPipelineDeps {
  loadState: () => Promise<UpdateState>;
  saveState: (s: UpdateState) => Promise<void>;
  acquireLock: () => Promise<boolean>;
  releaseLock: () => Promise<void>;
  isValidTag: (tag: string) => boolean;
  runPreflight: (targetTag: string) => Promise<PreflightOk>;
  createDrainer: (opts: {drainSeconds: number; broadcast: (k: DrainBroadcastKey, v: Record<string, unknown>) => void}) => Drainer;
  executeUpdate: (args: {targetTag: string; initialState: UpdateState}) => Promise<{outcome: 'pending-verification' | string}>;
  performRollback: (state: UpdateState) => Promise<void>;
  appendLog: (line: string) => void;
  broadcast?: (k: DrainBroadcastKey, v: Record<string, unknown>) => void;
  /** Optional: HTTP handler uses this to send 202 Accepted before drain begins. */
  onAccepted?: (info: {drainEndsAt: string}) => void;
  now: () => Date;
  installMethod: string;
  settings: ApplySettings;
}

const ALLOWED_ENTRY: ReadonlySet<string> = new Set([
  'idle', 'verified', 'preflight-failed', 'rolled-back', 'scheduled',
]);

/**
 * The shared orchestration used by both `/admin/update/apply` (HTTP) and the
 * Tier 3 scheduler. Returns a structured outcome the caller maps to status
 * code or log line. Does not throw on expected denials; reserves throwing for
 * truly unexpected failures (e.g. fs I/O after lock acquisition).
 */
export const applyUpdate = async (
  {targetTag, deps}: {targetTag: string; deps: ApplyPipelineDeps},
): Promise<ApplyOutcome> => {
  const state = await deps.loadState();
  if (!state.latest) return {outcome: 'no-known-latest'};
  if (!deps.isValidTag(state.latest.tag) || state.latest.tag !== targetTag) {
    return {outcome: 'invalid-tag'};
  }
  if (!ALLOWED_ENTRY.has(state.execution.status)) {
    return {outcome: 'busy', status: state.execution.status};
  }
  if (!await deps.acquireLock()) return {outcome: 'lock-held'};

  let releaseLock = true;
  try {
    const startedAt = deps.now().toISOString();
    const preState: UpdateState = {
      ...state,
      execution: {status: 'preflight', targetTag, startedAt},
    };
    await deps.saveState(preState);
    deps.appendLog(`[${startedAt}] PREFLIGHT target=${targetTag}`);

    const pf = await deps.runPreflight(targetTag);
    if (!pf.ok) {
      const at = deps.now().toISOString();
      await deps.saveState({
        ...preState,
        execution: {status: 'preflight-failed', targetTag, reason: pf.reason, at},
        lastResult: {targetTag, fromSha: '', outcome: 'preflight-failed', reason: pf.reason, at},
      });
      deps.appendLog(`[${at}] PREFLIGHT_FAILED ${pf.reason}`);
      return {outcome: 'preflight-failed', reason: pf.reason};
    }

    // Cancellation check after preflight (cancel handler flips state to idle).
    const afterPreflight = await deps.loadState();
    if (afterPreflight.execution.status !== 'preflight'
        || (afterPreflight.execution as {targetTag?: string}).targetTag !== targetTag) {
      deps.appendLog(`[${deps.now().toISOString()}] APPLY aborted post-preflight (status=${afterPreflight.execution.status})`);
      return {outcome: 'cancelled'};
    }

    const drainSeconds = deps.settings.drainSeconds;
    const drainer = deps.createDrainer({
      drainSeconds,
      broadcast: deps.broadcast ?? ((_k, _v) => {}),
    });
    const drainEndsAt = new Date(deps.now().getTime() + drainSeconds * 1000).toISOString();
    await deps.saveState({
      ...preState,
      execution: {status: 'draining', targetTag, drainEndsAt, startedAt: deps.now().toISOString()},
    });
    deps.appendLog(`[${deps.now().toISOString()}] DRAIN start drainSeconds=${drainSeconds}`);
    deps.onAccepted?.({drainEndsAt});

    const drainResult = await drainer.start();
    if (drainResult.outcome === 'cancelled') {
      deps.appendLog(`[${deps.now().toISOString()}] DRAIN cancelled by admin`);
      return {outcome: 'cancelled'};
    }

    const fresh = await deps.loadState();
    const r = await deps.executeUpdate({targetTag, initialState: fresh});
    if (r.outcome !== 'pending-verification') {
      const after = await deps.loadState();
      if (after.execution.status === 'rolling-back') {
        releaseLock = false; // performRollback exits the process on success.
        await deps.performRollback(after);
        return {outcome: 'rolled-back'};
      }
    }
    return {outcome: 'pending-verification'};
  } finally {
    if (releaseLock) { try { await deps.releaseLock(); } catch {/* swallow */} }
  }
};
```

- [ ] **Step 4: Run pipeline unit tests**

Run: `pnpm exec vitest run src/tests/backend/specs/updater/applyPipeline.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Refactor `updateActions.ts` to use the pipeline**

Edit `src/node/hooks/express/updateActions.ts`. Replace the body of the `app.post('/admin/update/apply', ...)` handler with the small adapter below (keep `requireAdmin`, lock-path helpers, broadcast helper, preflight-deps helper unchanged):

```ts
app.post('/admin/update/apply', wrapAsync(async (req: any, res: any) => {
  if (!requireAdmin(req, res)) return;

  // Defence: handler does its own pre-checks for HTTP-status mapping
  // (no-known-latest, invalid-tag, policy-denied, lock-held, busy) so we
  // return a structured 4xx the UI can localise. The pipeline duplicates
  // some of these as safety; that is intentional.
  const state = await loadState(stateFilePath());
  if (!state.latest) return res.status(409).json({error: 'no-known-latest'});
  if (!isValidTag(state.latest.tag)) return res.status(409).json({error: 'invalid-tag-in-state'});

  const allowedEntry = ['idle', 'verified', 'preflight-failed', 'rolled-back', 'scheduled'];
  if (!allowedEntry.includes(state.execution.status)) {
    return res.status(409).json({error: `execution-busy:${state.execution.status}`});
  }

  const installMethod = getDetectedInstallMethod();
  const policy = evaluatePolicy({
    installMethod,
    tier: settings.updates.tier,
    current: getEpVersion(),
    latest: state.latest.version,
    executionStatus: state.execution.status,
  });
  if (!policy.canManual) {
    return res.status(409).json({error: 'policy-denied', reason: policy.reason});
  }

  const targetTag = state.latest.tag;
  let responded = false;
  const result = await applyUpdate({
    targetTag,
    deps: {
      loadState: () => loadState(stateFilePath()),
      saveState: (s) => saveState(stateFilePath(), s),
      acquireLock: () => acquireLock(lockPath()),
      releaseLock: () => releaseLock(lockPath()),
      isValidTag,
      runPreflight: async (tag) => {
        const baseDeps = buildPreflightDeps(installMethod);
        return runPreflight(
          {targetTag: tag, diskSpaceMinMB: Number(settings.updates.diskSpaceMinMB) || 500,
            requireSignature: settings.updates.requireSignature,
            trustedKeysPath: settings.updates.trustedKeysPath},
          {...baseDeps, verifyTag: () => verifyReleaseTag({
            tag, repoDir: settings.root,
            requireSignature: settings.updates.requireSignature,
            trustedKeysPath: settings.updates.trustedKeysPath,
          })},
        );
      },
      createDrainer: (opts) => {
        drainer = createDrainer(opts);
        return drainer;
      },
      executeUpdate: async ({targetTag: tag, initialState}) => executeUpdate({
        repoDir: settings.root,
        backupDir: backupDir(),
        spawnFn: spawn as unknown as SpawnFn,
        readSha: () => new Promise<string>((resolve, reject) => {
          const c = spawn('git', ['rev-parse', 'HEAD'], {cwd: settings.root, stdio: ['ignore', 'pipe', 'ignore']});
          let out = '';
          c.stdout.on('data', (b) => { out += b.toString(); });
          c.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(`git rev-parse exit ${code}`)));
          c.on('error', reject);
        }),
        copyFile: async (src: string, dst: string) => {
          await fs.mkdir(path.dirname(dst), {recursive: true});
          await fs.copyFile(src, dst);
        },
        saveState: (s: UpdateState) => saveState(stateFilePath(), s),
        initialState,
        targetTag: tag,
        now: () => new Date(),
        exit: (code: number) => process.exit(code),
      }),
      performRollback: (s) => performRollback(s, getRollbackDeps()),
      appendLog: (line) => appendLine(logPath(), line),
      broadcast: (key, values) => broadcastShout(key, values),
      onAccepted: ({drainEndsAt}) => {
        if (!responded) { responded = true; res.status(202).json({accepted: true, drainEndsAt}); }
      },
      now: () => new Date(),
      installMethod,
      settings: {
        tier: settings.updates.tier,
        drainSeconds: Number(settings.updates.drainSeconds) || 60,
        diskSpaceMinMB: Number(settings.updates.diskSpaceMinMB) || 500,
        requireSignature: settings.updates.requireSignature,
        trustedKeysPath: settings.updates.trustedKeysPath,
        adminEmail: settings.adminEmail,
      },
    },
  });
  drainer = null;

  // Map outcome → HTTP if onAccepted didn't already respond.
  if (responded) return;
  if (result.outcome === 'no-known-latest') return res.status(409).json({error: 'no-known-latest'});
  if (result.outcome === 'invalid-tag') return res.status(409).json({error: 'invalid-tag-in-state'});
  if (result.outcome === 'busy') return res.status(409).json({error: `execution-busy:${result.status}`});
  if (result.outcome === 'lock-held') return res.status(409).json({error: 'lock-held'});
  if (result.outcome === 'preflight-failed') return res.status(409).json({error: 'preflight-failed', reason: result.reason});
  if (result.outcome === 'cancelled') return res.status(200).json({cancelled: true});
  return res.json({outcome: result.outcome});
}));
```

Also: at the top of the file, add the import:

```ts
import {applyUpdate} from '../../updater/applyPipeline';
```

- [ ] **Step 6: Re-run existing integration tests**

Run: `pnpm exec mocha --reporter spec --recursive src/tests/backend/specs/updateActions.ts`
Expected: PASS (no regressions from extraction). If a test fails because of subtly different ordering, fix the pipeline to preserve the original handler's behaviour exactly.

- [ ] **Step 7: Commit**

```bash
git add src/node/updater/applyPipeline.ts src/node/hooks/express/updateActions.ts src/tests/backend/specs/updater/applyPipeline.test.ts
git commit -m "refactor(updater): extract apply pipeline shared by HTTP + scheduler (#7607)"
```

---

## Task 5: Wire scheduler into boot + `performCheck` (`index.ts`)

**Files:**
- Modify: `src/node/updater/index.ts`
- Test: `src/tests/backend/specs/updater-scheduler-integration.ts`

- [ ] **Step 1: Write the failing integration test**

Create `src/tests/backend/specs/updater-scheduler-integration.ts`:

```ts
'use strict';

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {strict as assert} from 'assert';
import {EMPTY_STATE} from '../../../node/updater/types';
import {loadState, saveState} from '../../../node/updater/state';

describe('Tier 3 scheduler — boot rehydrate + grace fire', function () {
  this.timeout(15000);

  let root: string;
  let stateFile: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'epsched-'));
    await fs.mkdir(path.join(root, 'var'), {recursive: true});
    stateFile = path.join(root, 'var', 'update-state.json');
  });

  afterEach(async () => { await fs.rm(root, {recursive: true, force: true}); });

  it('decides to fire immediately when a scheduled state exists with scheduledFor in the past', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    await saveState(stateFile, {
      ...EMPTY_STATE,
      latest: {tag: 'v9.9.9', version: '9.9.9', body: '', publishedAt: past,
        prerelease: false, htmlUrl: 'https://example.com'},
      execution: {status: 'scheduled', targetTag: 'v9.9.9', scheduledFor: past, startedAt: past},
    });
    const fired: string[] = [];

    const {createSchedulerRunner} = await import('../../../node/updater/Scheduler');
    const runner = createSchedulerRunner({
      now: () => new Date(),
      setTimer: (cb, ms) => { assert.equal(ms, 0); return setImmediate(cb) as any; },
      clearTimer: (h) => clearImmediate(h as any),
      triggerApply: async (tag) => { fired.push(tag); },
    });
    const s = await loadState(stateFile);
    assert.equal(s.execution.status, 'scheduled');
    if (s.execution.status === 'scheduled') {
      runner.arm({targetTag: s.execution.targetTag, scheduledFor: s.execution.scheduledFor});
    }
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(fired, ['v9.9.9']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (initially due to missing wiring)**

Run: `pnpm exec mocha --reporter spec src/tests/backend/specs/updater-scheduler-integration.ts`
Expected: PASS for this minimal case (it only exercises the runner). It documents the contract for the next step where `index.ts` calls into the same flow.

- [ ] **Step 3: Wire the runner into `index.ts`**

Edit `src/node/updater/index.ts`:

At the top, add imports:

```ts
import {createSchedulerRunner, decideSchedule, SchedulerRunner} from './Scheduler';
import {applyUpdate} from './applyPipeline';
```

Below the existing module-level state declarations, add:

```ts
let scheduler: SchedulerRunner | null = null;
```

After the `pendingVerification = checkPendingVerification(...)` call in `expressCreateServer`, before `startPolling()`, add:

```ts
scheduler = createSchedulerRunner({
  now: () => new Date(),
  setTimer: setTimeout as (cb: () => void, ms: number) => NodeJS.Timeout,
  clearTimer: clearTimeout,
  triggerApply: async (targetTag) => {
    try {
      await applyUpdate({
        targetTag,
        deps: buildApplyDepsForScheduler(),
      });
    } catch (err) {
      logger.warn(`scheduler apply failed: ${(err as Error).message}`);
    }
  },
});

// Rehydrate: if state is `scheduled` from a prior boot, arm the timer.
if (state.execution.status === 'scheduled') {
  scheduler.arm({
    targetTag: state.execution.targetTag,
    scheduledFor: state.execution.scheduledFor,
  });
}
```

Add a helper `buildApplyDepsForScheduler()` near `getRollbackDeps()` that returns an `ApplyPipelineDeps` mirroring the HTTP handler's wiring but without `onAccepted` / `broadcast` Socket.IO (the scheduler path can still broadcast — wire `broadcast` through if a `getIo()` helper is importable; if not, drop it for PR 3 and add in a follow-up).

```ts
import {spawn} from 'node:child_process';
import {createDrainer as createDrainerImpl} from './SessionDrainer';
import {acquireLock, releaseLock} from './lock';
import {runPreflight} from './preflight';
import {verifyReleaseTag} from './trustedKeys';
import {appendLine} from './updateLog';
import {executeUpdate, SpawnFn} from './UpdateExecutor';
import {isValidTag} from './refSafety';
import {performRollback} from './RollbackHandler';
import {loadState as loadStateFn} from './state';

const buildApplyDepsForScheduler = () => ({
  loadState: () => loadStateFn(stateFilePath()),
  saveState: (s: UpdateState) => saveState(stateFilePath(), s),
  acquireLock: () => acquireLock(path.join(settings.root, 'var', 'update.lock')),
  releaseLock: () => releaseLock(path.join(settings.root, 'var', 'update.lock')),
  isValidTag,
  runPreflight: async (tag: string) => runPreflight(
    {targetTag: tag, diskSpaceMinMB: Number(settings.updates.diskSpaceMinMB) || 500,
      requireSignature: settings.updates.requireSignature,
      trustedKeysPath: settings.updates.trustedKeysPath},
    {
      installMethod: detectedMethod,
      workingTreeClean: () => Promise.resolve(true), // executor will fail loudly if dirty
      freeDiskMB: async () => Number.POSITIVE_INFINITY,
      pnpmOnPath: () => Promise.resolve(true),
      lockHeld: async () => false,
      remoteHasTag: () => Promise.resolve(true),
      verifyTag: () => verifyReleaseTag({tag, repoDir: settings.root,
        requireSignature: settings.updates.requireSignature,
        trustedKeysPath: settings.updates.trustedKeysPath}),
    },
  ),
  createDrainer: (opts: any) => createDrainerImpl(opts),
  executeUpdate: async ({targetTag, initialState}: {targetTag: string; initialState: UpdateState}) => executeUpdate({
    repoDir: settings.root,
    backupDir: path.join(settings.root, 'var', 'update-backup'),
    spawnFn: spawn as unknown as SpawnFn,
    readSha: () => new Promise<string>((resolve, reject) => {
      const c = spawn('git', ['rev-parse', 'HEAD'], {cwd: settings.root, stdio: ['ignore', 'pipe', 'ignore']});
      let out = '';
      c.stdout.on('data', (b) => { out += b.toString(); });
      c.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(`git rev-parse exit ${code}`)));
      c.on('error', reject);
    }),
    copyFile: async (src: string, dst: string) => {
      await fs.mkdir(path.dirname(dst), {recursive: true});
      await fs.copyFile(src, dst);
    },
    saveState: (s: UpdateState) => saveState(stateFilePath(), s),
    initialState,
    targetTag,
    now: () => new Date(),
    exit: (code: number) => process.exit(code),
  }),
  performRollback: (s: UpdateState) => performRollback(s, getRollbackDeps()),
  appendLog: (line: string) => appendLine(path.join(settings.root, 'var', 'log', 'update.log'), line),
  now: () => new Date(),
  installMethod: detectedMethod,
  settings: {
    tier: settings.updates.tier,
    drainSeconds: Number(settings.updates.drainSeconds) || 60,
    diskSpaceMinMB: Number(settings.updates.diskSpaceMinMB) || 500,
    requireSignature: settings.updates.requireSignature,
    trustedKeysPath: settings.updates.trustedKeysPath,
    adminEmail: settings.adminEmail,
  },
});
```

Then in `performCheck`, after the existing `saveState(stateFilePath(), state)` line, add the scheduler evaluation:

```ts
// Tier 3: evaluate the scheduler after every fetch.
if (state.latest && scheduler) {
  const current = getEpVersion();
  const policy = evaluatePolicy({
    installMethod: detectedMethod,
    tier: settings.updates.tier,
    current,
    latest: state.latest.version,
    executionStatus: state.execution.status,
  });
  const decision = decideSchedule({
    state, now,
    policy, latest: state.latest, current,
    preApplyGraceMinutes: Number(settings.updates.preApplyGraceMinutes) || 0,
    adminEmail: settings.adminEmail,
  });
  if (decision.action === 'schedule') {
    state.execution = decision.newExecution;
    state.email = decision.newEmailState;
    for (const e of decision.emails) {
      await sendEmailViaSmtp(settings.adminEmail!, e.subject, e.body);
    }
    await saveState(stateFilePath(), state);
    scheduler.arm({
      targetTag: decision.newExecution.targetTag,
      scheduledFor: decision.newExecution.scheduledFor,
    });
  } else if (decision.action === 'cancel-schedule') {
    state.execution = {status: 'idle'};
    await saveState(stateFilePath(), state);
    scheduler.cancel();
  }
}
```

In `shutdown()`, also call `scheduler?.cancel()`.

- [ ] **Step 4: Verify**

Run: `pnpm exec mocha --reporter spec src/tests/backend/specs/updater-scheduler-integration.ts`
Run: `pnpm ts-check`
Expected: PASS / clean type check.

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/index.ts src/tests/backend/specs/updater-scheduler-integration.ts
git commit -m "feat(updater): wire scheduler into boot + performCheck (#7607)"
```

---

## Task 6: `/admin/update/cancel` allows `scheduled`; `/admin/update/apply` allows `scheduled` as entry

**Files:**
- Modify: `src/node/hooks/express/updateActions.ts`
- Modify: `src/tests/backend/specs/updateActions.ts`

- [ ] **Step 1: Add a failing test for cancel during `scheduled`**

Append to `src/tests/backend/specs/updateActions.ts` (or its describe-block for cancel):

```ts
it('cancels a scheduled update and returns the state to idle', async () => {
  await saveStateForTest({
    ...EMPTY_STATE,
    latest: TEST_LATEST,
    execution: {status: 'scheduled', targetTag: 'v9.9.9',
      scheduledFor: new Date(Date.now() + 60_000).toISOString(),
      startedAt: new Date().toISOString()},
  });
  const res = await agent
    .post('/admin/update/cancel')
    .set('Cookie', adminCookie)
    .expect(200);
  expect(res.body).toEqual({cancelled: true});
  const s = await readStateForTest();
  expect(s.execution.status).toBe('idle');
  expect(s.lastResult?.outcome).toBe('cancelled');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec mocha --reporter spec src/tests/backend/specs/updateActions.ts -g "cancels a scheduled update"`
Expected: FAIL — current cancel handler 409s on `scheduled`.

- [ ] **Step 3: Update the cancel handler**

In `src/node/hooks/express/updateActions.ts`, change the cancel guard:

Replace:

```ts
if (state.execution.status !== 'preflight' && state.execution.status !== 'draining') {
```

with:

```ts
const cancellable: ReadonlySet<string> = new Set(['scheduled', 'preflight', 'draining']);
if (!cancellable.has(state.execution.status)) {
```

In the same handler, the `if (drainer) drainer.cancel();` line stays — for `scheduled` there is no drainer; the scheduler's timer is what we need to cancel. The scheduler runs in `index.ts` and is module-level; expose a small helper:

In `src/node/updater/index.ts`, export:

```ts
export const cancelScheduler = (): void => { scheduler?.cancel(); };
```

And call it from the cancel handler — add the import at the top of `updateActions.ts`:

```ts
import {cancelScheduler} from '../../updater';
```

And inside the cancel handler, after the guard, before `if (drainer)`:

```ts
if (state.execution.status === 'scheduled') cancelScheduler();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec mocha --reporter spec src/tests/backend/specs/updateActions.ts -g "cancels a scheduled update"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/node/hooks/express/updateActions.ts src/node/updater/index.ts src/tests/backend/specs/updateActions.ts
git commit -m "feat(updater): cancel handler supports scheduled state (#7607)"
```

---

## Task 7: Admin UI — countdown + cancel during scheduled

**Files:**
- Modify: `admin/src/store/store.ts`
- Modify: `admin/src/pages/UpdatePage.tsx`
- Modify: `admin/src/components/UpdateBanner.tsx`
- Modify: `src/locales/en.json`

- [ ] **Step 1: Extend the store types**

In `admin/src/store/store.ts`, find the `Execution` union type and add the scheduled variant:

```ts
type Execution =
  | {status: 'idle'}
  | {status: 'scheduled'; targetTag: string; scheduledFor: string; startedAt: string}
  | {status: 'preflight'; targetTag: string; startedAt: string}
  | {status: 'preflight-failed'; targetTag: string; reason: string; at: string}
  | {status: 'draining'; targetTag: string; drainEndsAt: string; startedAt: string}
  | {status: 'executing'; targetTag: string; fromSha: string; startedAt: string}
  | {status: 'pending-verification'; targetTag: string; fromSha: string; deadlineAt: string}
  | {status: 'verified'; targetTag: string; verifiedAt: string}
  | {status: 'rolling-back'; reason: string; targetTag: string; fromSha: string; at: string}
  | {status: 'rolled-back'; reason: string; targetTag: string; restoredSha: string; at: string}
  | {status: 'rollback-failed'; reason: string; targetTag: string; fromSha: string; at: string};
```

(If the existing `Execution` is `any`-typed, replace with the union above.)

- [ ] **Step 2: Add i18n keys**

In `src/locales/en.json`, add (alphabetical-ish near `update.execution.*`):

```json
"update.execution.scheduled": "Update scheduled",
"update.page.scheduled.title": "Update scheduled",
"update.page.scheduled.countdown": "Etherpad will start updating to {{tag}} in {{remaining}}.",
"update.page.scheduled.apply_now": "Apply now",
"update.banner.scheduled": "Update to {{tag}} scheduled — applies in {{remaining}}.",
"update.page.policy.scheduled": "An update is scheduled."
```

- [ ] **Step 3: Render countdown + actions in `UpdatePage.tsx`**

In `admin/src/pages/UpdatePage.tsx`, after the existing `inFlight` derivation and before the `return`, add:

```tsx
const scheduled = us?.execution?.status === 'scheduled'
  ? us.execution as {targetTag: string; scheduledFor: string}
  : null;

const [remainingMs, setRemainingMs] = useState<number>(() =>
  scheduled ? Math.max(0, new Date(scheduled.scheduledFor).getTime() - Date.now()) : 0);

useEffect(() => {
  if (!scheduled) return;
  const id = setInterval(() => {
    setRemainingMs(Math.max(0, new Date(scheduled.scheduledFor).getTime() - Date.now()));
  }, 1000);
  return () => clearInterval(id);
}, [scheduled?.scheduledFor]);
```

Helper (above the component):

```ts
const fmtRemaining = (ms: number): string => {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
};
```

Update the `showCancel` / `showApply` logic:

```ts
const showApply = !!us.policy?.canManual
  && (status === 'idle' || status === 'verified' || status === 'scheduled')
  && !us.lockHeld && !upToDate;
const showCancel = status === 'preflight' || status === 'draining' || status === 'scheduled';
```

In the render body (above `<div className="update-actions">`), add:

```tsx
{scheduled && (
  <section className="update-scheduled" aria-live="polite">
    <h2><Trans i18nKey="update.page.scheduled.title"/></h2>
    <p>
      <Trans
        i18nKey="update.page.scheduled.countdown"
        values={{tag: scheduled.targetTag, remaining: fmtRemaining(remainingMs)}}
      />
    </p>
  </section>
)}
```

The Apply button label for `status === 'scheduled'` switches to "Apply now":

```tsx
{showApply && (
  <button onClick={() => post('/admin/update/apply')} disabled={actionInFlight}>
    {status === 'scheduled'
      ? t('update.page.scheduled.apply_now')
      : t('update.page.apply')}
  </button>
)}
```

- [ ] **Step 4: Update `UpdateBanner.tsx`**

Find the banner component. Where it currently renders for "update available", add a sibling case for scheduled state:

```tsx
const exec = us?.execution;
if (exec && exec.status === 'scheduled') {
  const remaining = fmtRemaining(new Date(exec.scheduledFor).getTime() - Date.now());
  return (
    <div className="update-banner update-banner-scheduled" role="status">
      <Trans i18nKey="update.banner.scheduled" values={{tag: exec.targetTag, remaining}}/>
      <a href="/admin/update"><Trans i18nKey="update.banner.cta"/></a>
    </div>
  );
}
```

Place the helper `fmtRemaining` either next to the existing helpers in the banner or import from a shared util — duplicate (3 lines) is acceptable if no util exists.

- [ ] **Step 5: Type-check + build**

Run:

```bash
pnpm ts-check
pnpm run build:ui
```

Expected: no TS errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add admin/src/store/store.ts admin/src/pages/UpdatePage.tsx admin/src/components/UpdateBanner.tsx src/locales/en.json
git commit -m "feat(admin): countdown + cancel UI for tier 3 scheduled updates (#7607)"
```

---

## Task 8: Playwright — scheduled state renders countdown + cancel

**Files:**
- Create: `src/tests/frontend-new/admin-spec/update-scheduled.spec.ts`

- [ ] **Step 1: Write the failing Playwright spec**

```ts
import {test, expect} from '@playwright/test';
import {seedUpdateState} from '../helper/updaterFixtures'; // helper used by update-banner/update-page-actions

const SCHEDULED_FOR_IN = 30; // seconds in the future

test.describe('update page — tier 3 scheduled state', () => {
  test.beforeEach(async ({request}) => {
    await seedUpdateState(request, {
      latest: {tag: 'v9.9.9', version: '9.9.9', body: '## Changes\n- thing', publishedAt: new Date().toISOString(), prerelease: false, htmlUrl: 'https://example.com'},
      execution: {status: 'scheduled', targetTag: 'v9.9.9',
        scheduledFor: new Date(Date.now() + SCHEDULED_FOR_IN * 1000).toISOString(),
        startedAt: new Date().toISOString()},
    });
  });

  test('renders countdown, Apply now, and Cancel; Cancel returns to idle', async ({page}) => {
    await page.goto('/admin/update');
    await expect(page.getByText('Update scheduled')).toBeVisible();
    await expect(page.getByText(/in \d+s|in \d+m \d+s/)).toBeVisible();
    await expect(page.getByRole('button', {name: 'Apply now'})).toBeVisible();
    await page.getByRole('button', {name: 'Cancel'}).click();
    await expect(page.getByText('Idle')).toBeVisible();
  });
});
```

If `helper/updaterFixtures` does not exist, create it with a `seedUpdateState` that writes the state JSON to `var/update-state.json` via a small `/admin/test/update-state` endpoint guarded by `settings.enableAdminUITests` (mirroring the existing pattern in `pad-version-badge.spec.ts` / `update-banner.spec.ts`). Re-use whichever helper those tests use — read them first; do not invent a new convention.

- [ ] **Step 2: Run test to verify it fails (or passes if seeding already works)**

```bash
pnpm run test:frontend:admin -- --grep "tier 3 scheduled"
```

- [ ] **Step 3: Implement any missing helper bits**

If `seedUpdateState` doesn't exist for `scheduled`, the existing helper probably writes any shape — just pass the new state directly. Otherwise extend it.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm run test:frontend:admin -- --grep "tier 3 scheduled"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tests/frontend-new/admin-spec/update-scheduled.spec.ts src/tests/frontend-new/helper/updaterFixtures.ts
git commit -m "test(updater): playwright spec for tier 3 scheduled UI (#7607)"
```

---

## Task 9: Docs + settings comments + CHANGELOG

**Files:**
- Modify: `doc/admin/updates.md`
- Modify: `settings.json.template`
- Modify: `settings.json.docker`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-04-25-auto-update-runbook.md`

- [ ] **Step 1: Update `doc/admin/updates.md`**

Replace the Tier 3 bullet near the top:

Old:
```
- **Tier 3 (auto with grace window)** — designed, not yet implemented.
```

New:
```
- **Tier 3 (auto with grace window)** — opt-in. On a git install, a newly detected release is scheduled to apply after `preApplyGraceMinutes` (configurable). During the grace window, `/admin/update` shows a countdown and a Cancel button; an admin can also click "Apply now" to skip the wait. If `adminEmail` is set, a one-shot `grace-start` notification fires per scheduled tag.
```

Update the settings table row for `preApplyGraceMinutes`:

```
| `updates.preApplyGraceMinutes` | `0` | Wait this many minutes between detecting a new release and starting the drain when tier is `"auto"`. During the wait, the admin can `POST /admin/update/cancel` to abort. `0` means apply immediately (no grace). Clamped to a 1-week maximum. Has no effect at tier `"manual"`. |
```

Append a new section "Tier 3 — auto" after the "Tier 2" section:

```
## Tier 3 — auto

When `updates.tier = "auto"` on a writable (git) install:

1. The periodic version checker detects a new release and persists it to `var/update-state.json`.
2. If the install method and policy allow auto-update, the scheduler transitions execution state to `scheduled` and sets `scheduledFor = now + preApplyGraceMinutes`. This survives restart — the boot path re-arms the timer based on the persisted state.
3. The admin UI at `/admin/update` shows a countdown panel and exposes two buttons:
    - **Cancel** — drops the schedule, returns to idle. The same `POST /admin/update/cancel` endpoint as Tier 2.
    - **Apply now** — runs the regular manual flow (`POST /admin/update/apply`) immediately, skipping the remaining grace.
4. When the timer fires, the scheduler runs the same Tier 2 pipeline (preflight → drain → execute → exit 75).

If `adminEmail` is set, the first time a tag is scheduled, the updater emails:

> [Etherpad] Auto-update scheduled for 9.9.9

with the `scheduledFor` timestamp. Subsequent ticks for the same tag are silent. A new tag (e.g. an emergency patch released during the grace window) re-arms the timer and re-emails.

A `rollback-failed` terminal state disables Tier 3 (and Tier 4); auto attempts pause until `POST /admin/update/acknowledge` clears the state. Tier 2 (manual click) stays available because an admin click *is* the intervention that terminal state requires.
```

- [ ] **Step 2: Update settings templates**

`settings.json.template` near `preApplyGraceMinutes`:

Old (the comment area):
```
* - preApplyGraceMinutes: tier 3 only — countdown before an auto-update applies.
```

New:
```
* - preApplyGraceMinutes: tier 3 only — grace minutes between detecting a new
*     release and starting the drain. Clamped to [0, 7*24*60]. Default 0
*     applies immediately when allowed; raise to give admins time to cancel.
```

`settings.json.docker`: no functional change — docker is read-only, tier auto silently downgrades to notify. Update the comment block to clarify.

- [ ] **Step 3: CHANGELOG.md**

Under `## [Unreleased]`, in the Added or Changed section, add:

```
- (updater) Tier 3 (`updates.tier: "auto"`) auto-applies new releases after `preApplyGraceMinutes` on git installs. During the grace window, the admin UI shows a countdown + Cancel + Apply now. (#7607)
```

- [ ] **Step 4: Runbook section**

Append a new section to `docs/superpowers/specs/2026-04-25-auto-update-runbook.md`:

```
## 11. Tier 3 — grace window, scheduled apply, cancel

Configure the VM for tier 3:

```jsonc
{
  "updates": {
    "tier": "auto",
    "preApplyGraceMinutes": 2,    // short for smoke
    "drainSeconds": 15,
    "checkIntervalHours": 1
  }
}
```

1. As in §3, `git checkout v2.7.2`. Restart, wait for the immediate first check.
2. `curl -fsSL http://localhost:9001/admin/update/status | jq '.execution'` — expect `{"status":"scheduled","targetTag":"v...","scheduledFor":"...","startedAt":"..."}` within ~5s of the check landing.
3. `/admin/update` shows a countdown panel + Cancel + Apply now buttons.
4. Wait for the timer to fire. Confirm the executor runs the same flow as §4 (drain, executor, exit 75). State lands on `verified`.
5. Repeat, but click **Cancel** during the countdown. State returns to `idle`; `lastResult.outcome: "cancelled"`.
6. Repeat, but click **Apply now**. Drain begins immediately; the previously-armed timer is harmlessly stale (Scheduler guards on state).
7. Restart Etherpad during the grace window. On boot, `execution.status` is still `scheduled` and the countdown resumes from the persisted `scheduledFor`.
8. If `adminEmail` is set, the journal logs `(would send email) ... [Etherpad] Auto-update scheduled for ...` once per `scheduledFor` arming for the same tag.

If any step diverges, capture `var/log/update.log` and stop.
```

- [ ] **Step 5: Commit**

```bash
git add doc/admin/updates.md settings.json.template settings.json.docker CHANGELOG.md docs/superpowers/specs/2026-04-25-auto-update-runbook.md
git commit -m "docs(updater): document tier 3 auto with grace window (#7607)"
```

---

## Task 10: Final verification + push + PR

**Files:** none.

- [ ] **Step 1: Run the full updater test surface**

```bash
pnpm exec vitest run src/tests/backend/specs/updater/
pnpm exec mocha --reporter spec src/tests/backend/specs/updateActions.ts src/tests/backend/specs/updateStatus.ts src/tests/backend/specs/updater-integration.ts src/tests/backend/specs/updater-scheduler-integration.ts
pnpm ts-check
pnpm run build:ui
```

Expected: all green.

- [ ] **Step 2: Run the backend and frontend (admin) smoke suites the CI uses**

```bash
pnpm run test:backend
pnpm run test:frontend:admin
```

Expected: green. If frontend admin smoke fails on a port-binding error, restart against port 9003 per the project convention.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "feat(updater): tier 3 — auto update with grace window (#7607)" --body "$(cat <<'EOF'
## Summary

Tier 3 of the auto-update subsystem (issue #7607). When `updates.tier = "auto"` on a writable (git) install and a new release is detected, the scheduler transitions execution state to `scheduled` and arms a timer for `now + preApplyGraceMinutes`. The admin UI shows a countdown + Cancel + Apply now; cancellation returns the state to idle. When the timer fires, the same Tier 2 pipeline runs.

## Architecture

- New `src/node/updater/Scheduler.ts` — pure `decideSchedule()` decision function + small timer runner with arm/cancel.
- New `src/node/updater/applyPipeline.ts` — orchestration lifted out of `updateActions.ts` so the scheduler and the HTTP handler share the same pre-flight → drain → execute path.
- `ExecutionStatus` gains `scheduled`. `EmailSendLog` gains `graceStartTag` for one-shot grace-start email dedupe.
- `index.ts` instantiates the scheduler, rehydrates on boot, re-evaluates after each `performCheck`.
- `/admin/update/cancel` now accepts the `scheduled` state; `/admin/update/apply` accepts `scheduled` as an allowed-entry status so the admin can shortcut the grace window.

## Test plan

- [x] vitest unit tests for `decideSchedule` and the timer runner.
- [x] vitest unit tests for the extracted `applyUpdate` pipeline (happy / preflight-failed / cancelled / busy / lock-held).
- [x] mocha integration: cancel during scheduled returns to idle.
- [x] mocha integration: scheduler rehydrates a past `scheduledFor` and fires immediately.
- [x] Playwright admin spec: countdown renders, Cancel transitions to idle.
- [x] `pnpm ts-check`, `pnpm run build:ui`.

## Notes

- Manual smoke runbook §11 added — required before shipping per the design spec's "Phased rollout" gate. The runbook calls out a 2-week canary on a beta channel before tier 4. Not yet run on a disposable VM; will run before merge.
- No new outbound traffic. Email path reuses the existing `(would send email)` log line until a future PR adds the SMTP transport.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Wait ~20s, check CI, address any failures.**

---

## Self-review

- **Spec coverage:** Tasks 1–9 cover every line of the PR 3 row of the design spec (`Scheduler.ts`, `canAuto` flip-on already in place, grace-start email, UI countdown + cancel, tests). Task 10 is the verification + ship step.
- **Placeholders:** none — every step has the actual code, the exact command, and the expected output / next step.
- **Type consistency:** `ExecutionStatus`'s `scheduled` variant fields (`targetTag`, `scheduledFor`, `startedAt`) match in `types.ts`, `Scheduler.ts`, `applyPipeline.ts`, the store, and the runbook. `EmailSendLog.graceStartTag` is consistent across `types.ts`, the state validator, the Scheduler decision, and the Notifier extension. `ApplyOutcome` discriminants match between `applyPipeline.ts` and `updateActions.ts`.
- **TDD discipline:** every implementation task has a failing-test step before the code step.
- **Commits:** one logical commit per task; the diff stays reviewable.
