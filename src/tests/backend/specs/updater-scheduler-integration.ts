'use strict';

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {strict as assert} from 'assert';
import {EMPTY_STATE} from '../../../node/updater/types.js';
import {loadState, saveState} from '../../../node/updater/state.js';
import {createSchedulerRunner, decideSchedule} from '../../../node/updater/Scheduler.js';

describe('Tier 3 scheduler — boot rehydrate + grace fire', function (this: any) {
  this.timeout(15000);

  let root: string;
  let stateFile: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'epsched-'));
    await fs.mkdir(path.join(root, 'var'), {recursive: true});
    stateFile = path.join(root, 'var', 'update-state.json');
  });

  afterEach(async () => { await fs.rm(root, {recursive: true, force: true}); });

  it('fires triggerApply when scheduledFor is in the past on boot rehydrate', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    await saveState(stateFile, {
      ...EMPTY_STATE,
      latest: {
        tag: 'v9.9.9', version: '9.9.9', body: '',
        publishedAt: past, prerelease: false, htmlUrl: 'https://example.com',
      },
      execution: {status: 'scheduled', targetTag: 'v9.9.9', scheduledFor: past, startedAt: past},
    });

    const fired: string[] = [];
    const runner = createSchedulerRunner({
      now: () => new Date(),
      setTimer: (cb, ms) => {
        assert.equal(ms, 0, 'past scheduledFor should arm with delay=0');
        return setImmediate(cb) as unknown as NodeJS.Timeout;
      },
      clearTimer: (h) => clearImmediate(h as unknown as NodeJS.Immediate),
      triggerApply: async (tag) => { fired.push(tag); },
    });

    const s = await loadState(stateFile);
    assert.equal(s.execution.status, 'scheduled');
    if (s.execution.status === 'scheduled') {
      runner.arm({targetTag: s.execution.targetTag, scheduledFor: s.execution.scheduledFor});
    }
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(fired, ['v9.9.9']);
  });

  it('decideSchedule + saveState round-trip transitions idle → scheduled correctly', async () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const initial = {
      ...EMPTY_STATE,
      latest: {
        tag: 'v9.9.9', version: '9.9.9', body: '',
        publishedAt: now.toISOString(), prerelease: false, htmlUrl: 'https://example.com',
      },
    };
    await saveState(stateFile, initial);

    const state = await loadState(stateFile);
    const decision = decideSchedule({
      state, now,
      policy: {canNotify: true, canManual: true, canAuto: true, canAutonomous: false, reason: 'ok'},
      latest: state.latest!, current: '2.0.0',
      preApplyGraceMinutes: 30, adminEmail: null,
    });
    assert.equal(decision.action, 'schedule');
    if (decision.action === 'schedule') {
      const next = {...state, execution: decision.newExecution, email: decision.newEmailState};
      await saveState(stateFile, next);
    }

    const after = await loadState(stateFile);
    assert.equal(after.execution.status, 'scheduled');
    if (after.execution.status === 'scheduled') {
      assert.equal(after.execution.targetTag, 'v9.9.9');
      assert.equal(after.execution.scheduledFor, '2026-05-11T12:30:00.000Z');
    }
  });
});
