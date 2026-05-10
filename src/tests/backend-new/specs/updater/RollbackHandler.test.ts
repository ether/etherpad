import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {checkPendingVerification, performRollback, RollbackDeps} from '../../../../node/updater/RollbackHandler';
import {EMPTY_STATE} from '../../../../node/updater/types';

const okSpawn = (exit: number) => vi.fn(() => ({
  stdout: {on: () => {}},
  stderr: {on: () => {}},
  on: (e: string, cb: any) => { if (e === 'close') setImmediate(() => cb(exit)); },
})) as any;

const baseDeps = (): RollbackDeps => ({
  repoDir: '/srv/etherpad',
  backupDir: '/srv/etherpad/var/update-backup',
  spawnFn: okSpawn(0),
  copyFile: vi.fn(async () => {}),
  saveState: vi.fn(async () => {}),
  exit: vi.fn(),
  now: () => new Date('2026-05-08T10:00:00Z'),
  rollbackHealthCheckSeconds: 60,
});

describe('checkPendingVerification', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('idle state is a no-op (timer is not armed)', () => {
    const r = checkPendingVerification(structuredClone(EMPTY_STATE), baseDeps());
    expect(r.armed).toBe(false);
  });

  it('pending-verification with bootCount<=2 arms a timer and increments bootCount', async () => {
    const deps = baseDeps();
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {
        status: 'pending-verification' as const,
        targetTag: 'v2.7.3',
        fromSha: 'abc',
        deadlineAt: '2026-05-08T10:00:00Z',
      },
      bootCount: 0,
    };
    const r = checkPendingVerification(state, deps);
    expect(r.armed).toBe(true);
    expect(deps.saveState).toHaveBeenCalledWith(expect.objectContaining({bootCount: 1}));
    // markVerified clears the timer; advancing past the deadline does NOT trigger rollback.
    r.markVerified();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.runAllTimersAsync();
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it('markVerified persists the verified state with lastResult=verified', () => {
    const deps = baseDeps();
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {
        status: 'pending-verification' as const,
        targetTag: 'v2.7.3', fromSha: 'abc',
        deadlineAt: '2026-05-08T10:00:00Z',
      },
      bootCount: 0,
    };
    const r = checkPendingVerification(state, deps);
    r.markVerified();
    const lastSave = (deps.saveState as any).mock.calls.at(-1)[0];
    expect(lastSave.execution.status).toBe('verified');
    expect(lastSave.lastResult.outcome).toBe('verified');
    expect(lastSave.bootCount).toBe(0);
  });

  it('pending-verification with bootCount>2 forces immediate rollback', async () => {
    const deps = baseDeps();
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {
        status: 'pending-verification' as const,
        targetTag: 'v2.7.3', fromSha: 'abc',
        deadlineAt: '2026-05-08T10:00:00Z',
      },
      bootCount: 3,
    };
    const r = checkPendingVerification(state, deps);
    expect(r.armed).toBe(false);
    await vi.runAllTimersAsync();
    expect(deps.exit).toHaveBeenCalledWith(75);
  });

  it('timer expiry triggers rollback when markVerified is never called', async () => {
    const deps = baseDeps();
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {
        status: 'pending-verification' as const,
        targetTag: 'v2.7.3', fromSha: 'abc',
        deadlineAt: '2026-05-08T10:00:00Z',
      },
      bootCount: 0,
    };
    const r = checkPendingVerification(state, deps);
    expect(r.armed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.runAllTimersAsync();
    expect(deps.exit).toHaveBeenCalledWith(75);
  });
});

describe('performRollback', () => {
  it('happy path: restores lockfile, checks out fromSha, retries pnpm install, exits 75', async () => {
    const deps = baseDeps();
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {
        status: 'rolling-back' as const,
        reason: 'install-failed',
        targetTag: 'v2.7.3', fromSha: 'abc',
        at: '2026-05-08T10:00:00Z',
      },
      bootCount: 0,
    };
    await performRollback(state, deps);
    expect(deps.copyFile).toHaveBeenCalledWith(
      '/srv/etherpad/var/update-backup/pnpm-lock.yaml',
      '/srv/etherpad/pnpm-lock.yaml',
    );
    const lastSave = (deps.saveState as any).mock.calls.at(-1)[0];
    expect(lastSave.execution.status).toBe('rolled-back');
    expect(lastSave.lastResult.outcome).toBe('rolled-back');
    expect(deps.exit).toHaveBeenCalledWith(75);
  });

  it('rollback failure (lockfile copy throws) lands on rollback-failed terminal', async () => {
    const deps = baseDeps();
    deps.copyFile = vi.fn(async () => { throw new Error('EACCES'); });
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {
        status: 'rolling-back' as const,
        reason: 'install-failed',
        targetTag: 'v2.7.3', fromSha: 'abc',
        at: '2026-05-08T10:00:00Z',
      },
      bootCount: 0,
    };
    await performRollback(state, deps);
    const lastSave = (deps.saveState as any).mock.calls.at(-1)[0];
    expect(lastSave.execution.status).toBe('rollback-failed');
    expect(lastSave.lastResult.outcome).toBe('rollback-failed');
    expect(deps.exit).toHaveBeenCalledWith(75);
  });

  it('rollback failure (git checkout exits non-zero) lands on rollback-failed', async () => {
    const deps = baseDeps();
    let calls = 0;
    deps.spawnFn = vi.fn(() => ({
      stdout: {on: () => {}},
      stderr: {on: () => {}},
      on: (e: string, cb: any) => { if (e === 'close') setImmediate(() => cb(calls++ === 0 ? 1 : 0)); },
    })) as any;
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {
        status: 'rolling-back' as const,
        reason: 'build-failed',
        targetTag: 'v2.7.3', fromSha: 'abc',
        at: '2026-05-08T10:00:00Z',
      },
      bootCount: 0,
    };
    await performRollback(state, deps);
    const lastSave = (deps.saveState as any).mock.calls.at(-1)[0];
    expect(lastSave.execution.status).toBe('rollback-failed');
  });

  it('rollback failure (pnpm install exits non-zero) lands on rollback-failed', async () => {
    const deps = baseDeps();
    let calls = 0;
    deps.spawnFn = vi.fn(() => ({
      stdout: {on: () => {}},
      stderr: {on: () => {}},
      on: (e: string, cb: any) => { if (e === 'close') setImmediate(() => cb(calls++ === 0 ? 0 : 1)); },
    })) as any;
    const state = {
      ...structuredClone(EMPTY_STATE),
      execution: {
        status: 'rolling-back' as const,
        reason: 'build-failed',
        targetTag: 'v2.7.3', fromSha: 'abc',
        at: '2026-05-08T10:00:00Z',
      },
      bootCount: 0,
    };
    await performRollback(state, deps);
    const lastSave = (deps.saveState as any).mock.calls.at(-1)[0];
    expect(lastSave.execution.status).toBe('rollback-failed');
  });

  it('throws when called from an unexpected status', async () => {
    const deps = baseDeps();
    const state = structuredClone(EMPTY_STATE);
    await expect(performRollback(state, deps)).rejects.toThrow();
  });
});
