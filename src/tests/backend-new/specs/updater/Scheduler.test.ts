import {describe, it, expect} from 'vitest';
import {decideSchedule, createSchedulerRunner, decideTriggerApply} from '../../../../node/updater/Scheduler';
import {EMPTY_STATE, UpdateState, ReleaseInfo, PolicyResult} from '../../../../node/updater/types';

const fakeRelease = (tag: string, version = tag.replace(/^v/, '')): ReleaseInfo => ({
  tag,
  version,
  body: '',
  publishedAt: '2026-05-11T00:00:00.000Z',
  prerelease: false,
  htmlUrl: `https://github.com/ether/etherpad/releases/tag/${tag}`,
});

const policyOk: PolicyResult = {
  canNotify: true, canManual: true, canAuto: true, canAutonomous: false, reason: 'ok',
};
const policyNoAuto: PolicyResult = {
  canNotify: true, canManual: true, canAuto: false, canAutonomous: false, reason: 'ok',
};

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
      expect(d.newExecution.startedAt).toBe(NOW.toISOString());
      expect(d.emails).toEqual([]);
    }
  });

  it('emits a grace-start email when adminEmail set and tag changed', () => {
    const state: UpdateState = {
      ...EMPTY_STATE,
      latest: fakeRelease('v2.0.1'),
      email: {...EMPTY_STATE.email, graceStartTag: null},
    };
    const d = decideSchedule({
      state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: 15, adminEmail: 'ops@example.com',
    });
    expect(d.action).toBe('schedule');
    if (d.action === 'schedule') {
      expect(d.emails).toHaveLength(1);
      expect(d.emails[0].kind).toBe('grace-start');
      expect(d.emails[0].subject).toContain('2.0.1');
      expect(d.newEmailState.graceStartTag).toBe('v2.0.1');
    }
  });

  it('does not re-email grace-start when same tag stays scheduled (restart-in-grace)', () => {
    const state: UpdateState = {
      ...EMPTY_STATE,
      latest: fakeRelease('v2.0.1'),
      execution: {
        status: 'scheduled', targetTag: 'v2.0.1',
        scheduledFor: '2026-05-11T12:14:00.000Z',
        startedAt: '2026-05-11T11:59:00.000Z',
      },
      email: {...EMPTY_STATE.email, graceStartTag: 'v2.0.1'},
    };
    const d = decideSchedule({
      state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: 15, adminEmail: 'ops@example.com',
    });
    expect(d).toEqual({action: 'nothing'});
  });

  it('reschedules when a newer tag appears mid-grace', () => {
    const state: UpdateState = {
      ...EMPTY_STATE,
      latest: fakeRelease('v2.0.2'),
      execution: {
        status: 'scheduled', targetTag: 'v2.0.1',
        scheduledFor: '2026-05-11T12:14:00.000Z',
        startedAt: '2026-05-11T11:59:00.000Z',
      },
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
      execution: {
        status: 'scheduled', targetTag: 'v2.0.1',
        scheduledFor: '2026-05-11T12:14:00.000Z',
        startedAt: '2026-05-11T11:59:00.000Z',
      },
    };
    const d = decideSchedule({
      state, now: NOW, policy: policyNoAuto, latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: 15, adminEmail: null,
    });
    expect(d).toEqual({action: 'cancel-schedule', reason: 'policy-denied'});
  });

  it('does nothing during in-flight statuses (preflight/draining/executing)', () => {
    const inFlightExecutions: UpdateState['execution'][] = [
      {status: 'preflight', targetTag: 'v2.0.1', startedAt: '2026-05-11T11:00:00.000Z'},
      {status: 'draining', targetTag: 'v2.0.1', drainEndsAt: '2026-05-11T12:01:00.000Z', startedAt: '2026-05-11T12:00:00.000Z'},
      {status: 'executing', targetTag: 'v2.0.1', fromSha: 'abc', startedAt: '2026-05-11T12:00:00.000Z'},
      {status: 'rolling-back', targetTag: 'v2.0.1', fromSha: 'abc', reason: 'build', at: '2026-05-11T12:00:00.000Z'},
      {status: 'pending-verification', targetTag: 'v2.0.1', fromSha: 'abc', deadlineAt: '2026-05-11T12:01:00.000Z'},
    ];
    for (const exec of inFlightExecutions) {
      const state: UpdateState = {...EMPTY_STATE, latest: fakeRelease('v2.0.1'), execution: exec};
      const d = decideSchedule({
        state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.0',
        preApplyGraceMinutes: 15, adminEmail: null,
      });
      expect(d).toEqual({action: 'nothing'});
    }
  });

  it('does nothing during terminal statuses (preflight-failed, rolled-back, rollback-failed)', () => {
    const terminalExecutions: UpdateState['execution'][] = [
      {status: 'preflight-failed', targetTag: 'v2.0.1', reason: 'no-disk', at: '2026-05-11T12:00:00.000Z'},
      {status: 'rolled-back', targetTag: 'v2.0.1', restoredSha: 'abc', reason: 'install', at: '2026-05-11T12:00:00.000Z'},
      {status: 'rollback-failed', targetTag: 'v2.0.1', fromSha: 'abc', reason: 'install', at: '2026-05-11T12:00:00.000Z'},
    ];
    for (const exec of terminalExecutions) {
      const state: UpdateState = {...EMPTY_STATE, latest: fakeRelease('v2.0.1'), execution: exec};
      const d = decideSchedule({
        state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.0',
        preApplyGraceMinutes: 15, adminEmail: null,
      });
      expect(d).toEqual({action: 'nothing'});
    }
  });

  it('schedules from `verified` status (last update completed; new release detected)', () => {
    const state: UpdateState = {
      ...EMPTY_STATE,
      latest: fakeRelease('v2.0.2'),
      execution: {status: 'verified', targetTag: 'v2.0.1', verifiedAt: '2026-05-10T00:00:00.000Z'},
    };
    const d = decideSchedule({
      state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.1',
      preApplyGraceMinutes: 15, adminEmail: null,
    });
    expect(d.action).toBe('schedule');
    if (d.action === 'schedule') expect(d.newExecution.targetTag).toBe('v2.0.2');
  });

  it('clamps preApplyGraceMinutes to 0 when negative or NaN', () => {
    const state: UpdateState = {...EMPTY_STATE, latest: fakeRelease('v2.0.1')};
    for (const m of [-5, 0, NaN]) {
      const d = decideSchedule({
        state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.0',
        preApplyGraceMinutes: m, adminEmail: null,
      });
      expect(d.action).toBe('schedule');
      if (d.action === 'schedule') expect(d.newExecution.scheduledFor).toBe(NOW.toISOString());
    }
  });

  it('clamps preApplyGraceMinutes to 7 days when absurdly large', () => {
    const state: UpdateState = {...EMPTY_STATE, latest: fakeRelease('v2.0.1')};
    const d = decideSchedule({
      state, now: NOW, policy: policyOk, latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: 99999, adminEmail: null,
    });
    expect(d.action).toBe('schedule');
    if (d.action === 'schedule') {
      const delta = new Date(d.newExecution.scheduledFor).getTime() - NOW.getTime();
      expect(delta).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });
});

describe('createSchedulerRunner', () => {
  it('arms a timer for `scheduledFor` and fires triggerApply once', async () => {
    let fired = 0;
    let lastTag = '';
    const runner = createSchedulerRunner({
      now: () => new Date('2026-05-11T12:00:00.000Z'),
      setTimer: (cb) => setImmediate(cb) as unknown as NodeJS.Timeout,
      clearTimer: (h) => clearImmediate(h as unknown as NodeJS.Immediate),
      triggerApply: async (tag) => { fired++; lastTag = tag; },
    });
    runner.arm({targetTag: 'v2.0.1', scheduledFor: '2026-05-11T12:15:00.000Z'});
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(fired).toBe(1);
    expect(lastTag).toBe('v2.0.1');
  });

  it('clears the previous timer when arm() is called again', () => {
    const cleared: unknown[] = [];
    let next = 0;
    const runner = createSchedulerRunner({
      now: () => new Date('2026-05-11T12:00:00.000Z'),
      setTimer: () => (++next) as unknown as NodeJS.Timeout,
      clearTimer: (h) => { cleared.push(h); },
      triggerApply: async () => {},
    });
    runner.arm({targetTag: 'v2.0.1', scheduledFor: '2026-05-11T12:15:00.000Z'});
    runner.arm({targetTag: 'v2.0.2', scheduledFor: '2026-05-11T12:30:00.000Z'});
    expect(cleared).toEqual([1]);
  });

  it('cancel() clears the timer; idempotent', () => {
    const cleared: unknown[] = [];
    let next = 0;
    const runner = createSchedulerRunner({
      now: () => new Date('2026-05-11T12:00:00.000Z'),
      setTimer: () => (++next) as unknown as NodeJS.Timeout,
      clearTimer: (h) => { cleared.push(h); },
      triggerApply: async () => {},
    });
    runner.arm({targetTag: 'v2.0.1', scheduledFor: '2026-05-11T12:15:00.000Z'});
    runner.cancel();
    runner.cancel();
    expect(cleared).toEqual([1]);
  });

  it('fires immediately (delay=0) when scheduledFor is in the past', async () => {
    let fired = 0;
    let observedDelay = -1;
    const runner = createSchedulerRunner({
      now: () => new Date('2026-05-11T13:00:00.000Z'),
      setTimer: (cb, ms) => { observedDelay = ms; return setImmediate(cb) as any; },
      clearTimer: (h) => clearImmediate(h as any),
      triggerApply: async () => { fired++; },
    });
    runner.arm({targetTag: 'v2.0.1', scheduledFor: '2026-05-11T12:15:00.000Z'});
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(observedDelay).toBe(0);
    expect(fired).toBe(1);
  });

  it('cancel() after fire is a no-op (does not crash, no double-clear)', async () => {
    const cleared: unknown[] = [];
    const runner = createSchedulerRunner({
      now: () => new Date('2026-05-11T12:00:00.000Z'),
      setTimer: (cb) => setImmediate(cb) as any,
      clearTimer: (h) => { cleared.push(h); },
      triggerApply: async () => {},
    });
    runner.arm({targetTag: 'v2.0.1', scheduledFor: '2026-05-11T12:15:00.000Z'});
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    runner.cancel();
    expect(cleared).toEqual([]);
  });
});

describe('decideTriggerApply', () => {
  const release: ReleaseInfo = {
    tag: 'v2.0.1', version: '2.0.1', body: '', publishedAt: '2026-05-11T00:00:00.000Z',
    prerelease: false, htmlUrl: 'https://example.com',
  };
  const scheduledState: UpdateState = {
    ...EMPTY_STATE,
    latest: release,
    execution: {
      status: 'scheduled', targetTag: 'v2.0.1',
      scheduledFor: '2026-05-11T12:15:00.000Z', startedAt: '2026-05-11T12:00:00.000Z',
    },
  };
  const policyAllow: PolicyResult = {
    canNotify: true, canManual: true, canAuto: true, canAutonomous: false, reason: 'ok',
  };
  const policyDeny: PolicyResult = {
    canNotify: true, canManual: true, canAuto: false, canAutonomous: false, reason: 'install-method-not-writable',
  };

  it('fires when state is scheduled for the same tag and policy allows', () => {
    const d = decideTriggerApply({state: scheduledState, targetTag: 'v2.0.1', policy: policyAllow});
    expect(d).toEqual({action: 'fire'});
  });

  it('aborts when persisted state is no longer scheduled (admin cancelled at the boundary)', () => {
    const d = decideTriggerApply({
      state: {...scheduledState, execution: {status: 'idle'}},
      targetTag: 'v2.0.1', policy: policyAllow,
    });
    expect(d.action).toBe('abort');
    if (d.action === 'abort') expect(d.reason).toContain('state=idle');
  });

  it('aborts when persisted state is scheduled for a different tag (manual apply already overwrote it)', () => {
    const d = decideTriggerApply({
      state: {
        ...scheduledState,
        execution: {status: 'scheduled', targetTag: 'v2.0.2',
          scheduledFor: '2026-05-11T13:00:00.000Z', startedAt: '2026-05-11T12:30:00.000Z'},
      },
      targetTag: 'v2.0.1', policy: policyAllow,
    });
    expect(d.action).toBe('abort');
    if (d.action === 'abort') expect(d.reason).toContain('tag=v2.0.2');
  });

  it('aborts when there is no known latest release (rare race with state corruption)', () => {
    const d = decideTriggerApply({
      state: {...scheduledState, latest: null},
      targetTag: 'v2.0.1', policy: policyAllow,
    });
    expect(d).toEqual({action: 'abort', reason: 'no-latest'});
  });

  it('clears the schedule when policy now denies auto (tier flipped during grace)', () => {
    const d = decideTriggerApply({state: scheduledState, targetTag: 'v2.0.1', policy: policyDeny});
    expect(d.action).toBe('clear-schedule');
    if (d.action === 'clear-schedule') expect(d.reason).toBe('install-method-not-writable');
  });

  it('falls back to a generic reason when the policy result has no reason', () => {
    const d = decideTriggerApply({
      state: scheduledState, targetTag: 'v2.0.1',
      policy: {canNotify: true, canManual: true, canAuto: false, canAutonomous: false, reason: ''},
    });
    expect(d).toEqual({action: 'clear-schedule', reason: 'policy-denied'});
  });
});

describe('Tier 4 — maintenance-window gating', () => {
  const release: ReleaseInfo = {
    tag: 'v2.0.1', version: '2.0.1', body: '', publishedAt: '2026-05-11T00:00:00.000Z',
    prerelease: false, htmlUrl: 'https://example.com',
  };
  const policyAutonomous: PolicyResult = {
    canNotify: true, canManual: true, canAuto: true, canAutonomous: true, reason: 'ok',
  };
  const window = {start: '03:00', end: '05:00', tz: 'utc' as const};

  it('decideSchedule snaps scheduledFor forward to the next window opening', () => {
    const state: UpdateState = {...EMPTY_STATE, latest: release};
    const d = decideSchedule({
      state, now: new Date('2026-05-11T10:00:00.000Z'), policy: policyAutonomous,
      latest: release, current: '2.0.0', preApplyGraceMinutes: 15, adminEmail: null,
      maintenanceWindow: window,
    });
    expect(d.action).toBe('schedule');
    if (d.action === 'schedule') {
      expect(d.newExecution.scheduledFor).toBe('2026-05-12T03:00:00.000Z');
    }
  });

  it('decideSchedule keeps scheduledFor at now+grace when grace lands inside the window', () => {
    const state: UpdateState = {...EMPTY_STATE, latest: release};
    const d = decideSchedule({
      state, now: new Date('2026-05-11T03:30:00.000Z'), policy: policyAutonomous,
      latest: release, current: '2.0.0', preApplyGraceMinutes: 15, adminEmail: null,
      maintenanceWindow: window,
    });
    expect(d.action).toBe('schedule');
    if (d.action === 'schedule') {
      expect(d.newExecution.scheduledFor).toBe('2026-05-11T03:45:00.000Z');
    }
  });

  it('decideSchedule ignores the window when policy.canAutonomous is false', () => {
    const state: UpdateState = {...EMPTY_STATE, latest: release};
    const d = decideSchedule({
      state, now: new Date('2026-05-11T10:00:00.000Z'),
      policy: {...policyAutonomous, canAutonomous: false},
      latest: release, current: '2.0.0', preApplyGraceMinutes: 15, adminEmail: null,
      maintenanceWindow: window,
    });
    expect(d.action).toBe('schedule');
    if (d.action === 'schedule') {
      // Standard tier 3 grace, no snap.
      expect(d.newExecution.scheduledFor).toBe('2026-05-11T10:15:00.000Z');
    }
  });

  it('decideTriggerApply defers when canAutonomous + outside window at fire time', () => {
    const state: UpdateState = {
      ...EMPTY_STATE, latest: release,
      execution: {status: 'scheduled', targetTag: 'v2.0.1',
        scheduledFor: '2026-05-11T03:00:00.000Z', startedAt: '2026-05-11T02:45:00.000Z'},
    };
    const d = decideTriggerApply({
      state, targetTag: 'v2.0.1', policy: policyAutonomous,
      now: new Date('2026-05-11T10:00:00.000Z'), maintenanceWindow: window,
    });
    expect(d.action).toBe('defer');
    if (d.action === 'defer') {
      expect(d.nextStart).toBe('2026-05-12T03:00:00.000Z');
      expect(d.reason).toBe('outside-maintenance-window');
    }
  });

  it('decideTriggerApply fires when canAutonomous + inside window', () => {
    const state: UpdateState = {
      ...EMPTY_STATE, latest: release,
      execution: {status: 'scheduled', targetTag: 'v2.0.1',
        scheduledFor: '2026-05-11T03:00:00.000Z', startedAt: '2026-05-11T02:45:00.000Z'},
    };
    const d = decideTriggerApply({
      state, targetTag: 'v2.0.1', policy: policyAutonomous,
      now: new Date('2026-05-11T03:30:00.000Z'), maintenanceWindow: window,
    });
    expect(d).toEqual({action: 'fire'});
  });

  it('decideSchedule re-uses graceStartTag dedupe across a defer/re-schedule cycle', () => {
    const state: UpdateState = {
      ...EMPTY_STATE, latest: release,
      email: {...EMPTY_STATE.email, graceStartTag: 'v2.0.1'},
    };
    const d = decideSchedule({
      state, now: new Date('2026-05-11T10:00:00.000Z'), policy: policyAutonomous,
      latest: release, current: '2.0.0', preApplyGraceMinutes: 15,
      adminEmail: 'ops@example.com', maintenanceWindow: window,
    });
    expect(d.action).toBe('schedule');
    if (d.action === 'schedule') expect(d.emails).toEqual([]);
  });
});
