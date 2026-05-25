'use strict';

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {strict as assert} from 'assert';
import {EMPTY_STATE, MaintenanceWindow, PolicyResult, ReleaseInfo} from '../../../node/updater/types.js';
import {loadState, saveState} from '../../../node/updater/state.js';
import {decideSchedule, decideTriggerApply} from '../../../node/updater/Scheduler.js';

const release: ReleaseInfo = {
  tag: 'v9.9.9',
  version: '9.9.9',
  body: '',
  publishedAt: '2026-05-11T00:00:00.000Z',
  prerelease: false,
  htmlUrl: 'https://example.com',
};

const policyAutonomous: PolicyResult = {
  canNotify: true, canManual: true, canAuto: true, canAutonomous: true, reason: 'ok',
};

const window: MaintenanceWindow = {start: '03:00', end: '05:00', tz: 'utc'};

describe('Tier 4 scheduler — maintenance-window boundary integration', function () {

  let root: string;
  let stateFile: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'epwindow-'));
    await fs.mkdir(path.join(root, 'var'), {recursive: true});
    stateFile = path.join(root, 'var', 'update-state.json');
  });

  afterEach(async () => { await fs.rm(root, {recursive: true, force: true}); });

  it('outside-window: snap scheduledFor forward to next opening and persist', async () => {
    const now = new Date('2026-05-11T10:00:00.000Z');
    const initial = {...EMPTY_STATE, latest: release};
    await saveState(stateFile, initial);

    const state = await loadState(stateFile);
    const decision = decideSchedule({
      state, now, policy: policyAutonomous, latest: release, current: '2.0.0',
      preApplyGraceMinutes: 1, adminEmail: null, maintenanceWindow: window,
    });
    assert.equal(decision.action, 'schedule');
    if (decision.action !== 'schedule') return;
    assert.equal(decision.newExecution.scheduledFor, '2026-05-12T03:00:00.000Z');

    await saveState(stateFile, {...state, execution: decision.newExecution});
    const reloaded = await loadState(stateFile);
    assert.equal(reloaded.execution.status, 'scheduled');
    if (reloaded.execution.status !== 'scheduled') return;
    assert.equal(reloaded.execution.scheduledFor, '2026-05-12T03:00:00.000Z');
  });

  it('inside-window at fire-time: decideTriggerApply returns fire', async () => {
    const stateOnDisk = {
      ...EMPTY_STATE,
      latest: release,
      execution: {
        status: 'scheduled' as const, targetTag: release.tag,
        scheduledFor: '2026-05-12T03:00:00.000Z',
        startedAt: '2026-05-11T10:00:00.000Z',
      },
    };
    await saveState(stateFile, stateOnDisk);
    const state = await loadState(stateFile);

    const decision = decideTriggerApply({
      state, targetTag: release.tag, policy: policyAutonomous,
      now: new Date('2026-05-12T03:30:00.000Z'), maintenanceWindow: window,
    });
    assert.deepEqual(decision, {action: 'fire'});
  });

  it('window-closes-mid-grace: defer carries a new nextStart and persists', async () => {
    const stateOnDisk = {
      ...EMPTY_STATE,
      latest: release,
      execution: {
        status: 'scheduled' as const, targetTag: release.tag,
        scheduledFor: '2026-05-12T03:01:00.000Z',
        startedAt: '2026-05-11T10:00:00.000Z',
      },
    };
    await saveState(stateFile, stateOnDisk);
    const state = await loadState(stateFile);

    const fireTimeOutsideWindow = new Date('2026-05-12T06:00:00.000Z');
    const decision = decideTriggerApply({
      state, targetTag: release.tag, policy: policyAutonomous,
      now: fireTimeOutsideWindow, maintenanceWindow: window,
    });
    assert.equal(decision.action, 'defer');
    if (decision.action !== 'defer') return;
    assert.equal(decision.nextStart, '2026-05-13T03:00:00.000Z');
    assert.equal(decision.reason, 'outside-maintenance-window');

    // Runner-level behavior: persist the new scheduledFor.
    if (state.execution.status !== 'scheduled') return;
    await saveState(stateFile, {
      ...state,
      execution: {...state.execution, scheduledFor: decision.nextStart},
    });
    const reloaded = await loadState(stateFile);
    if (reloaded.execution.status !== 'scheduled') return;
    assert.equal(reloaded.execution.scheduledFor, '2026-05-13T03:00:00.000Z');
  });

  it('cancel during deferred-grace: state returns to idle', async () => {
    const stateOnDisk = {
      ...EMPTY_STATE,
      latest: release,
      execution: {
        status: 'scheduled' as const, targetTag: release.tag,
        scheduledFor: '2026-05-12T03:00:00.000Z',
        startedAt: '2026-05-11T10:00:00.000Z',
      },
    };
    await saveState(stateFile, stateOnDisk);

    // Cancel happens via /admin/update/cancel; here we simulate the state
    // transition the handler performs.
    const state = await loadState(stateFile);
    await saveState(stateFile, {...state, execution: {status: 'idle'}});

    const reloaded = await loadState(stateFile);
    assert.equal(reloaded.execution.status, 'idle');

    // After cancel, the next periodic check would re-schedule (correct
    // behavior — tier flip is the way to opt out). decideSchedule on the
    // cancelled state should re-emit a schedule snapped to the next window.
    const decision = decideSchedule({
      state: reloaded, now: new Date('2026-05-12T06:00:00.000Z'),
      policy: policyAutonomous, latest: release, current: '2.0.0',
      preApplyGraceMinutes: 0, adminEmail: null, maintenanceWindow: window,
    });
    assert.equal(decision.action, 'schedule');
    if (decision.action !== 'schedule') return;
    assert.equal(decision.newExecution.scheduledFor, '2026-05-13T03:00:00.000Z');
  });
});
