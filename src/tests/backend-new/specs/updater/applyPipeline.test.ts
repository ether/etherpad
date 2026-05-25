import {describe, it, expect, vi} from 'vitest';
import {applyUpdate, ApplyPipelineDeps} from '../../../../node/updater/applyPipeline.js';
import {EMPTY_STATE, ReleaseInfo, UpdateState} from '../../../../node/updater/types.js';

const TEST_RELEASE: ReleaseInfo = {
  tag: 'v2.0.1',
  version: '2.0.1',
  body: '',
  publishedAt: '2026-05-11T00:00:00.000Z',
  prerelease: false,
  htmlUrl: 'https://github.com/ether/etherpad/releases/tag/v2.0.1',
};

const makeState = (over: Partial<UpdateState> = {}): UpdateState => ({
  ...structuredClone(EMPTY_STATE),
  latest: TEST_RELEASE,
  ...over,
});

interface Recording {
  saved: UpdateState[];
  log: string[];
  acceptedAt: string | null;
  rollbacks: UpdateState[];
}

const baseDeps = (
  initial: UpdateState = makeState(),
  policy: 'manual' | 'auto' = 'manual',
): {deps: ApplyPipelineDeps; rec: Recording; loadState: () => UpdateState} => {
  const rec: Recording = {saved: [], log: [], acceptedAt: null, rollbacks: []};
  let current = initial;
  const deps: ApplyPipelineDeps = {
    loadState: async () => current,
    saveState: async (s) => { current = s; rec.saved.push(structuredClone(s)); },
    acquireLock: async () => true,
    releaseLock: async () => {},
    isValidTag: () => true,
    runPreflight: async () => ({ok: true}),
    createDrainer: () => ({
      start: async () => ({outcome: 'completed'}),
      cancel: () => {},
    }),
    executeUpdate: async () => ({outcome: 'pending-verification'}),
    performRollback: async (s) => { rec.rollbacks.push(s); },
    appendLog: (line) => { rec.log.push(line); },
    broadcast: () => {},
    onAccepted: ({drainEndsAt}) => { rec.acceptedAt = drainEndsAt; },
    now: () => new Date('2026-05-11T12:00:00.000Z'),
    installMethod: 'git',
    settings: {
      tier: policy === 'auto' ? 'auto' : 'manual',
      drainSeconds: 1,
      diskSpaceMinMB: 1,
      requireSignature: false,
      trustedKeysPath: null,
      adminEmail: null,
    },
  };
  return {deps, rec, loadState: () => current};
};

describe('applyUpdate (extracted pipeline)', () => {
  it('runs preflight → drain → execute and returns pending-verification on the happy path', async () => {
    const {deps, rec} = baseDeps();
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r).toEqual({outcome: 'pending-verification'});
    expect(rec.acceptedAt).not.toBeNull();
    // Saved sequence: preflight → draining; executor itself saves further states.
    const statuses = rec.saved.map((s) => s.execution.status);
    expect(statuses).toContain('preflight');
    expect(statuses).toContain('draining');
  });

  it('returns preflight-failed and writes lastResult when preflight rejects', async () => {
    const {deps, rec, loadState} = baseDeps();
    deps.runPreflight = async () => ({ok: false, reason: 'low-disk-space'});
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r).toEqual({outcome: 'preflight-failed', reason: 'low-disk-space'});
    expect(rec.acceptedAt).toBeNull(); // never accepted into drain
    const final = loadState();
    expect(final.execution.status).toBe('preflight-failed');
    expect(final.lastResult?.outcome).toBe('preflight-failed');
    expect(final.lastResult?.reason).toBe('low-disk-space');
  });

  it('preserves the preflight detail in the returned reason (HTTP + email use the return value)', async () => {
    // Regression: applyUpdate built `reasonStr = reason: detail` for state +
    // logs but returned only `pf.reason`, so /admin/update/apply 409 bodies
    // and failure-notify emails lost the engine-mismatch detail.
    const {deps, loadState} = baseDeps();
    deps.runPreflight = async () => ({
      ok: false,
      reason: 'node-engine-mismatch',
      detail: 'target requires Node >=26.0.0, running 25.0.0',
    });
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r).toEqual({
      outcome: 'preflight-failed',
      reason: 'node-engine-mismatch: target requires Node >=26.0.0, running 25.0.0',
    });
    const final = loadState();
    expect(final.lastResult?.reason)
        .toBe('node-engine-mismatch: target requires Node >=26.0.0, running 25.0.0');
  });

  it('returns cancelled when the post-preflight state check shows state was reset (admin cancelled mid-preflight)', async () => {
    const {deps} = baseDeps();
    // First preflight pass mutates state to 'preflight'. Then the cancel handler
    // (simulated) flips it back to idle before the pipeline re-reads.
    let postPreflightTick = 0;
    const realLoad = deps.loadState;
    deps.loadState = async () => {
      const s = await realLoad();
      // The pipeline calls loadState() many times: 1) before preflight, 2) right after
      // preflight (the cancel-detection check). Flip to idle on the second call.
      postPreflightTick++;
      if (postPreflightTick === 2) return makeState();
      return s;
    };
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r).toEqual({outcome: 'cancelled'});
  });

  it('returns cancelled when drainer reports cancelled', async () => {
    const {deps} = baseDeps();
    deps.createDrainer = () => ({
      start: async () => ({outcome: 'cancelled'}),
      cancel: () => {},
    });
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r).toEqual({outcome: 'cancelled'});
  });

  it('returns lock-held when the lock cannot be acquired', async () => {
    const {deps} = baseDeps();
    deps.acquireLock = async () => false;
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r).toEqual({outcome: 'lock-held'});
  });

  it('returns no-known-latest when state has no latest release', async () => {
    const {deps} = baseDeps(makeState({latest: null}));
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r).toEqual({outcome: 'no-known-latest'});
  });

  it('returns invalid-tag when the supplied targetTag does not match state.latest.tag', async () => {
    const {deps} = baseDeps();
    const r = await applyUpdate({targetTag: 'v9.9.9', deps});
    expect(r).toEqual({outcome: 'invalid-tag'});
  });

  it('returns invalid-tag when isValidTag rejects the tag', async () => {
    const {deps} = baseDeps();
    deps.isValidTag = () => false;
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r).toEqual({outcome: 'invalid-tag'});
  });

  it('returns busy when the entry status is not allowed', async () => {
    const {deps} = baseDeps(makeState({
      execution: {status: 'executing', targetTag: 'v2.0.0', fromSha: 'abc',
        startedAt: '2026-05-11T11:00:00.000Z'},
    }));
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r).toEqual({outcome: 'busy', status: 'executing'});
  });

  it('accepts `scheduled` as an allowed entry status (admin clicks Apply now during grace)', async () => {
    const {deps} = baseDeps(makeState({
      execution: {status: 'scheduled', targetTag: 'v2.0.1',
        scheduledFor: '2026-05-11T12:15:00.000Z',
        startedAt: '2026-05-11T11:59:00.000Z'},
    }));
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r).toEqual({outcome: 'pending-verification'});
  });

  it('runs performRollback when executor returns a rolling-back state', async () => {
    const {deps, rec, loadState} = baseDeps();
    deps.executeUpdate = async () => ({outcome: 'failed-install', reason: 'pnpm exit 1'});
    // Simulate the executor having flipped state to rolling-back.
    const orig = deps.saveState;
    let interceptCount = 0;
    deps.executeUpdate = async () => {
      interceptCount++;
      const s = await deps.loadState();
      await deps.saveState({
        ...s,
        execution: {status: 'rolling-back', targetTag: 'v2.0.1', fromSha: 'abc',
          reason: 'failed-install', at: '2026-05-11T12:00:30.000Z'},
      });
      return {outcome: 'failed-install', reason: 'pnpm exit 1'};
    };
    const r = await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(r).toEqual({outcome: 'rolled-back'});
    expect(rec.rollbacks).toHaveLength(1);
    expect(rec.rollbacks[0].execution.status).toBe('rolling-back');
    expect(interceptCount).toBe(1);
    void orig;
  });

  it('releases the lock in the happy path', async () => {
    const {deps} = baseDeps();
    const releaseSpy = vi.fn(async () => {});
    deps.releaseLock = releaseSpy;
    await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT release the lock on the rollback path (process exits via performRollback)', async () => {
    const {deps} = baseDeps();
    const releaseSpy = vi.fn(async () => {});
    deps.releaseLock = releaseSpy;
    deps.executeUpdate = async () => {
      const s = await deps.loadState();
      await deps.saveState({
        ...s,
        execution: {status: 'rolling-back', targetTag: 'v2.0.1', fromSha: 'abc',
          reason: 'failed-build', at: '2026-05-11T12:00:30.000Z'},
      });
      return {outcome: 'failed-build', reason: 'tsc'};
    };
    await applyUpdate({targetTag: 'v2.0.1', deps});
    expect(releaseSpy).not.toHaveBeenCalled();
  });
});
