import path from 'node:path';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {executeUpdate, ExecutorDeps} from '../../../../node/updater/UpdateExecutor';
import {EMPTY_STATE, UpdateState} from '../../../../node/updater/types';

interface ScriptStep {cmd: string; exit: number; stderr?: string}

const okSpawn = (script: ScriptStep[]) => {
  let i = 0;
  return vi.fn((cmd: string, args: string[]) => {
    const step = script[i++];
    if (!step) throw new Error(`Unexpected spawn call: ${cmd} ${args.join(' ')}`);
    const expected = step.cmd;
    const actual = `${cmd} ${args.join(' ')}`;
    if (expected !== actual) {
      throw new Error(`Spawn order mismatch: expected "${expected}", got "${actual}"`);
    }
    return {
      stdout: {on: () => {}},
      stderr: {on: (e: string, cb: any) => { if (e === 'data' && step.stderr) cb(Buffer.from(step.stderr)); }},
      on: (e: string, cb: any) => { if (e === 'close') setImmediate(() => cb(step.exit)); },
    };
  });
};

const baseDeps = (): {
  deps: ExecutorDeps;
  states: UpdateState[];
  copies: Array<{src: string; dst: string}>;
  exitedWith: {code: number | null};
  fromShaUsed: {value: string | null};
} => {
  const states: UpdateState[] = [];
  const copies: Array<{src: string; dst: string}> = [];
  const exitedWith = {code: null as number | null};
  const fromShaUsed = {value: null as string | null};
  return {
    deps: {
      repoDir: '/srv/etherpad',
      backupDir: '/srv/etherpad/var/update-backup',
      spawnFn: okSpawn([
        {cmd: 'git fetch --tags origin', exit: 0},
        {cmd: 'git checkout refs/tags/v2.7.3', exit: 0},
        {cmd: 'pnpm install --frozen-lockfile', exit: 0},
        {cmd: 'pnpm run build:ui', exit: 0},
      ]) as any,
      readSha: vi.fn(async () => { fromShaUsed.value = 'abc123'; return 'abc123'; }),
      copyFile: vi.fn(async (src: string, dst: string) => { copies.push({src, dst}); }),
      saveState: vi.fn(async (s: UpdateState) => { states.push(structuredClone(s)); }),
      initialState: structuredClone(EMPTY_STATE),
      targetTag: 'v2.7.3',
      now: () => new Date('2026-05-08T10:00:00Z'),
      exit: (code: number) => { exitedWith.code = code; },
    },
    states,
    copies,
    exitedWith,
    fromShaUsed,
  };
};

describe('executeUpdate', () => {
  it('happy path: snapshots, runs steps, persists pending-verification, exits 75', async () => {
    const {deps, states, copies, exitedWith} = baseDeps();
    const r = await executeUpdate(deps);
    expect(r).toEqual({outcome: 'pending-verification'});
    expect(copies).toEqual([
      {
        src: path.join(deps.repoDir, 'pnpm-lock.yaml'),
        dst: path.join(deps.backupDir, 'pnpm-lock.yaml'),
      },
    ]);
    expect(states.at(-1)?.execution.status).toBe('pending-verification');
    expect((states.at(-1)?.execution as any).fromSha).toBe('abc123');
    expect(states.at(-1)?.bootCount).toBe(0);
    expect(exitedWith.code).toBe(75);
  });

  it('records the executing -> pending-verification transition in saveState calls', async () => {
    const {deps, states} = baseDeps();
    await executeUpdate(deps);
    const statuses = states.map((s) => s.execution.status);
    expect(statuses[0]).toBe('executing');
    expect(statuses.at(-1)).toBe('pending-verification');
  });

  it('install failure flips state to rolling-back without exiting', async () => {
    const {deps, states, exitedWith} = baseDeps();
    deps.spawnFn = okSpawn([
      {cmd: 'git fetch --tags origin', exit: 0},
      {cmd: 'git checkout refs/tags/v2.7.3', exit: 0},
      {cmd: 'pnpm install --frozen-lockfile', exit: 1, stderr: 'resolver bork'},
    ]) as any;
    const r = await executeUpdate(deps);
    expect(r.outcome).toBe('failed-install');
    expect(states.at(-1)?.execution.status).toBe('rolling-back');
    expect((states.at(-1)?.execution as any).reason).toContain('pnpm install exit 1');
    expect(exitedWith.code).toBeNull(); // executor must not exit on failure paths
  });

  it('build failure flips state to rolling-back', async () => {
    const {deps, states, exitedWith} = baseDeps();
    deps.spawnFn = okSpawn([
      {cmd: 'git fetch --tags origin', exit: 0},
      {cmd: 'git checkout refs/tags/v2.7.3', exit: 0},
      {cmd: 'pnpm install --frozen-lockfile', exit: 0},
      {cmd: 'pnpm run build:ui', exit: 2, stderr: 'tsc bork'},
    ]) as any;
    const r = await executeUpdate(deps);
    expect(r.outcome).toBe('failed-build');
    expect(states.at(-1)?.execution.status).toBe('rolling-back');
    expect(exitedWith.code).toBeNull();
  });

  it('checkout failure flips state to rolling-back (no copyFile? actually copies first)', async () => {
    // copyFile is called before any spawn; checkout is the second spawn so by then the
    // backup lockfile is in place. This matters: rollback needs the backup to exist.
    const {deps, copies, states} = baseDeps();
    deps.spawnFn = okSpawn([
      {cmd: 'git fetch --tags origin', exit: 0},
      {cmd: 'git checkout refs/tags/v2.7.3', exit: 1, stderr: 'conflict'},
    ]) as any;
    const r = await executeUpdate(deps);
    expect(r.outcome).toBe('failed-checkout');
    expect(copies.length).toBe(1); // backup taken before any mutation
    expect(states.at(-1)?.execution.status).toBe('rolling-back');
  });

  it('git-fetch failure flips state to rolling-back', async () => {
    const {deps, states} = baseDeps();
    deps.spawnFn = okSpawn([
      {cmd: 'git fetch --tags origin', exit: 128, stderr: 'cannot reach origin'},
    ]) as any;
    const r = await executeUpdate(deps);
    expect(r.outcome).toBe('failed-checkout');
    expect(states.at(-1)?.execution.status).toBe('rolling-back');
  });

  it('captures fromSha into the rolling-back state so RollbackHandler can restore it', async () => {
    const {deps, states} = baseDeps();
    deps.spawnFn = okSpawn([
      {cmd: 'git fetch --tags origin', exit: 0},
      {cmd: 'git checkout refs/tags/v2.7.3', exit: 0},
      {cmd: 'pnpm install --frozen-lockfile', exit: 1},
    ]) as any;
    await executeUpdate(deps);
    expect((states.at(-1)?.execution as any).fromSha).toBe('abc123');
  });
});
