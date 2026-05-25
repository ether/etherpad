import * as assert from 'node:assert/strict';
import {execSync, spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {executeUpdate} from '../../../node/updater/UpdateExecutor.js';
import {performRollback, checkPendingVerification} from '../../../node/updater/RollbackHandler.js';
import {EMPTY_STATE, UpdateState} from '../../../node/updater/types.js';

const sh = (cmd: string, opts: any = {}) =>
  execSync(cmd, {stdio: 'pipe', ...opts}).toString().trim();

// On Windows, git's child processes can briefly hold file handles after exit
// (NTFS lazy-release / antivirus / pack files), so an immediate rmdir on the
// temp repo hits EBUSY. fs.rm's built-in retry clears the flake.
const cleanupTmp = (dir: string) =>
  fs.rm(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});

const buildTmpRepo = async (): Promise<{dir: string; v1Sha: string; v2Sha: string}> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-it-'));
  sh('git init -b main', {cwd: dir});
  sh('git config user.email test@example.com', {cwd: dir});
  sh('git config user.name test', {cwd: dir});
  sh('git config commit.gpgsign false', {cwd: dir});
  sh('git config tag.gpgSign false', {cwd: dir});
  await fs.writeFile(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: x\n');
  sh('git add . && git commit -m initial', {cwd: dir});
  sh('git tag v0.0.1', {cwd: dir});
  const v1Sha = sh('git rev-parse HEAD', {cwd: dir});
  await fs.writeFile(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: y\n');
  sh('git add . && git commit -m bump', {cwd: dir});
  sh('git tag v0.0.2', {cwd: dir});
  const v2Sha = sh('git rev-parse HEAD', {cwd: dir});
  // Reset to v1 — that's our "currently installed" version.
  sh('git checkout v0.0.1', {cwd: dir});
  // Add a self-pointing origin so executor's git fetch works.
  sh(`git remote add origin ${dir}`, {cwd: dir});
  // Pre-prime origin's tag list (git fetch from a local origin sees both).
  return {dir, v1Sha, v2Sha};
};

/**
 * Spawn override: route every git ... call to the real binary, but stub pnpm
 * to a controlled exit code. Lets tests assert "git fetch + checkout actually
 * mutated the repo" without ever invoking pnpm install for real.
 */
const stubSpawn = (pnpmExits: Record<string, number>) =>
  (cmd: string, args: string[], opts: any) => {
    if (cmd === 'pnpm') {
      const key = `pnpm ${args.join(' ')}`;
      const exit = pnpmExits[key];
      if (exit === undefined) {
        throw new Error(`Unexpected pnpm call in integration stub: ${key}`);
      }
      return {
        stdout: {on: () => {}},
        stderr: {on: () => {}},
        on: (e: string, cb: any) => { if (e === 'close') setImmediate(() => cb(exit)); },
      };
    }
    return spawn(cmd, args, opts);
  };

describe(__filename, () => {
  it('happy path: executes against tmp repo, lands on pending-verification, exits 75', async () => {
    const {dir, v1Sha} = await buildTmpRepo();
    try {
      const states: UpdateState[] = [];
      let exitedWith: number | null = null;
      const r = await executeUpdate({
        repoDir: dir,
        backupDir: path.join(dir, 'var', 'update-backup'),
        spawnFn: stubSpawn({
          'pnpm install --frozen-lockfile': 0,
          'pnpm run build:ui': 0,
        }) as any,
        readSha: async () => sh('git rev-parse HEAD', {cwd: dir}),
        copyFile: async (s, d) => {
          await fs.mkdir(path.dirname(d), {recursive: true});
          await fs.copyFile(s, d);
        },
        saveState: async (s) => { states.push(structuredClone(s)); },
        initialState: structuredClone(EMPTY_STATE),
        targetTag: 'v0.0.2',
        now: () => new Date(),
        exit: (code) => { exitedWith = code; },
      });
      assert.equal(r.outcome, 'pending-verification');
      assert.equal(exitedWith, 75);
      assert.equal(states.at(-1)!.execution.status, 'pending-verification');
      // Working tree is now on v0.0.2.
      assert.equal(sh('git rev-parse HEAD', {cwd: dir}), sh('git rev-parse v0.0.2', {cwd: dir}));
      // Backup has the v0.0.1-era lockfile.
      const backup = await fs.readFile(path.join(dir, 'var', 'update-backup', 'pnpm-lock.yaml'), 'utf8');
      assert.match(backup, /lockfileVersion: x/);
      // The fromSha recorded in state matches the v0.0.1 SHA.
      assert.equal((states.at(-1)!.execution as {fromSha: string}).fromSha, v1Sha);
    } finally {
      await cleanupTmp(dir);
    }
  });

  it('install failure rolls back to original SHA + lockfile', async () => {
    const {dir, v1Sha} = await buildTmpRepo();
    try {
      const states: UpdateState[] = [];
      let exitedWith: number | null = null;

      // Phase 1: executor with failing install.
      await executeUpdate({
        repoDir: dir,
        backupDir: path.join(dir, 'var', 'update-backup'),
        spawnFn: stubSpawn({'pnpm install --frozen-lockfile': 1}) as any,
        readSha: async () => sh('git rev-parse HEAD', {cwd: dir}),
        copyFile: async (s, d) => {
          await fs.mkdir(path.dirname(d), {recursive: true});
          await fs.copyFile(s, d);
        },
        saveState: async (s) => { states.push(structuredClone(s)); },
        initialState: structuredClone(EMPTY_STATE),
        targetTag: 'v0.0.2',
        now: () => new Date(),
        exit: (c) => { exitedWith = c; },
      });
      assert.equal(states.at(-1)!.execution.status, 'rolling-back');

      // Phase 2: rollback.
      await performRollback(states.at(-1)!, {
        repoDir: dir,
        backupDir: path.join(dir, 'var', 'update-backup'),
        spawnFn: stubSpawn({'pnpm install --frozen-lockfile': 0}) as any,
        copyFile: (s, d) => fs.copyFile(s, d),
        saveState: async (s) => { states.push(structuredClone(s)); },
        exit: (c) => { exitedWith = c; },
        now: () => new Date(),
        rollbackHealthCheckSeconds: 60,
      });
      assert.equal(states.at(-1)!.execution.status, 'rolled-back');
      assert.equal(sh('git rev-parse HEAD', {cwd: dir}), v1Sha);
      assert.equal(exitedWith, 75);
      // Working tree's pnpm-lock.yaml was restored from backup.
      const lock = await fs.readFile(path.join(dir, 'pnpm-lock.yaml'), 'utf8');
      assert.match(lock, /lockfileVersion: x/);
    } finally {
      await cleanupTmp(dir);
    }
  });

  it('build failure rolls back to original SHA', async () => {
    const {dir, v1Sha} = await buildTmpRepo();
    try {
      const states: UpdateState[] = [];

      await executeUpdate({
        repoDir: dir,
        backupDir: path.join(dir, 'var', 'update-backup'),
        spawnFn: stubSpawn({
          'pnpm install --frozen-lockfile': 0,
          'pnpm run build:ui': 1,
        }) as any,
        readSha: async () => sh('git rev-parse HEAD', {cwd: dir}),
        copyFile: async (s, d) => {
          await fs.mkdir(path.dirname(d), {recursive: true});
          await fs.copyFile(s, d);
        },
        saveState: async (s) => { states.push(structuredClone(s)); },
        initialState: structuredClone(EMPTY_STATE),
        targetTag: 'v0.0.2',
        now: () => new Date(),
        exit: () => {},
      });
      assert.equal(states.at(-1)!.execution.status, 'rolling-back');

      await performRollback(states.at(-1)!, {
        repoDir: dir,
        backupDir: path.join(dir, 'var', 'update-backup'),
        spawnFn: stubSpawn({'pnpm install --frozen-lockfile': 0}) as any,
        copyFile: (s, d) => fs.copyFile(s, d),
        saveState: async (s) => { states.push(structuredClone(s)); },
        exit: () => {},
        now: () => new Date(),
        rollbackHealthCheckSeconds: 60,
      });
      assert.equal(states.at(-1)!.execution.status, 'rolled-back');
      assert.equal(sh('git rev-parse HEAD', {cwd: dir}), v1Sha);
    } finally {
      await cleanupTmp(dir);
    }
  });

  it('crash-loop guard: bootCount=3 forces immediate rollback', async () => {
    const {dir, v1Sha} = await buildTmpRepo();
    try {
      // Simulate "post-update boot": working tree on v0.0.2, backup lockfile from v0.0.1
      // already in place, state is pending-verification with bootCount=3.
      sh('git checkout v0.0.2', {cwd: dir});
      await fs.mkdir(path.join(dir, 'var', 'update-backup'), {recursive: true});
      // Backup the v0.0.1 lockfile content (we know v0.0.1's lockfile was 'x' from buildTmpRepo).
      await fs.writeFile(path.join(dir, 'var', 'update-backup', 'pnpm-lock.yaml'), 'lockfileVersion: x\n');

      const states: UpdateState[] = [];
      let exitedWith: number | null = null;
      const state: UpdateState = {
        ...structuredClone(EMPTY_STATE),
        execution: {
          status: 'pending-verification',
          targetTag: 'v0.0.2',
          fromSha: v1Sha,
          deadlineAt: '2026-05-08T10:00:00Z',
        },
        bootCount: 3,
      };
      const r = checkPendingVerification(state, {
        repoDir: dir,
        backupDir: path.join(dir, 'var', 'update-backup'),
        spawnFn: stubSpawn({'pnpm install --frozen-lockfile': 0}) as any,
        copyFile: (s, d) => fs.copyFile(s, d),
        saveState: async (s) => { states.push(structuredClone(s)); },
        exit: (c) => { exitedWith = c; },
        now: () => new Date(),
        rollbackHealthCheckSeconds: 60,
      });
      assert.equal(r.armed, false);
      // Poll for the fire-and-forget rollback to land in its terminal state.
      // A flat sleep here was racy on Windows (git checkout + spawned-process
      // bookkeeping can push past several hundred ms).
      const deadline = Date.now() + 10_000;
      while (
        states.at(-1)?.execution.status !== 'rolled-back' &&
        states.at(-1)?.execution.status !== 'rollback-failed' &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(states.at(-1)!.execution.status, 'rolled-back');
      assert.equal(sh('git rev-parse HEAD', {cwd: dir}), v1Sha);
      assert.equal(exitedWith, 75);
    } finally {
      await cleanupTmp(dir);
    }
  });

  it('rollback failure (target SHA does not exist) lands on terminal rollback-failed', async () => {
    const {dir} = await buildTmpRepo();
    try {
      const states: UpdateState[] = [];
      let exitedWith: number | null = null;
      const state: UpdateState = {
        ...structuredClone(EMPTY_STATE),
        execution: {
          status: 'rolling-back',
          reason: 'install-failed',
          targetTag: 'v0.0.2',
          // 40 hex chars but no such commit — git checkout -f will reject.
          fromSha: '0000000000000000000000000000000000000000',
          at: '2026-05-08T10:00:00Z',
        },
      };
      await performRollback(state, {
        repoDir: dir,
        backupDir: path.join(dir, 'var', 'update-backup'),
        spawnFn: stubSpawn({'pnpm install --frozen-lockfile': 0}) as any,
        copyFile: (s, d) => fs.copyFile(s, d),
        saveState: async (s) => { states.push(structuredClone(s)); },
        exit: (c) => { exitedWith = c; },
        now: () => new Date(),
        rollbackHealthCheckSeconds: 60,
      });
      assert.equal(states.at(-1)!.execution.status, 'rollback-failed');
      assert.equal(states.at(-1)!.lastResult!.outcome, 'rollback-failed');
      assert.equal(exitedWith, 75);
    } finally {
      await cleanupTmp(dir);
    }
  });
});
