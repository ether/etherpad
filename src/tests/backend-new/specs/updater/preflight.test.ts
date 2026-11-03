import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {execSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  runPreflight, PreflightDeps, isPorcelainClean, gitWorkingTreeClean,
} from '../../../../node/updater/preflight';
import type {VerifyResult} from '../../../../node/updater/trustedKeys';

const baseDeps = (): PreflightDeps => ({
  installMethod: 'git',
  workingTreeClean: vi.fn(async () => true),
  freeDiskMB: vi.fn(async () => 5000),
  pnpmOnPath: vi.fn(async () => true),
  lockHeld: vi.fn(async () => false),
  remoteHasTag: vi.fn(async () => true),
  verifyTag: vi.fn(async (): Promise<VerifyResult> => ({ok: true, reason: 'signature-not-required'})),
  readTargetEnginesNode: vi.fn(async () => null),
});

const baseInput = {
  targetTag: 'v2.7.3',
  diskSpaceMinMB: 500,
  requireSignature: false,
  trustedKeysPath: null as string | null,
  currentNodeVersion: '25.0.0',
};

describe('runPreflight', () => {
  it('passes when all checks pass', async () => {
    const r = await runPreflight(baseInput, baseDeps());
    expect(r).toEqual({ok: true});
  });

  it('rejects non-writable install methods', async () => {
    const r = await runPreflight(baseInput, {...baseDeps(), installMethod: 'docker'});
    expect(r).toEqual({ok: false, reason: 'install-method-not-writable'});
  });

  it('rejects npm install method too (not yet writable)', async () => {
    const r = await runPreflight(baseInput, {...baseDeps(), installMethod: 'npm'});
    expect(r).toEqual({ok: false, reason: 'install-method-not-writable'});
  });

  it('rejects a dirty working tree', async () => {
    const r = await runPreflight(baseInput, {...baseDeps(), workingTreeClean: vi.fn(async () => false)});
    expect(r).toEqual({ok: false, reason: 'dirty-working-tree'});
  });

  it('rejects insufficient disk space', async () => {
    const r = await runPreflight(baseInput, {...baseDeps(), freeDiskMB: vi.fn(async () => 100)});
    expect(r).toEqual({ok: false, reason: 'low-disk-space'});
  });

  it('rejects when pnpm is missing', async () => {
    const r = await runPreflight(baseInput, {...baseDeps(), pnpmOnPath: vi.fn(async () => false)});
    expect(r).toEqual({ok: false, reason: 'pnpm-not-found'});
  });

  it('rejects when the lock is held', async () => {
    const r = await runPreflight(baseInput, {...baseDeps(), lockHeld: vi.fn(async () => true)});
    expect(r).toEqual({ok: false, reason: 'lock-held'});
  });

  it('rejects when the remote tag is missing', async () => {
    const r = await runPreflight(baseInput, {...baseDeps(), remoteHasTag: vi.fn(async () => false)});
    expect(r).toEqual({ok: false, reason: 'remote-tag-missing'});
  });

  it('rejects when signature verification fails', async () => {
    const r = await runPreflight(baseInput, {
      ...baseDeps(),
      verifyTag: vi.fn(async (): Promise<VerifyResult> => ({ok: false, reason: 'signature-verification-failed'})),
    });
    expect(r).toEqual({ok: false, reason: 'signature-verification-failed'});
  });

  it('cheap-check failures short-circuit before slow checks', async () => {
    const deps = {...baseDeps(), installMethod: 'docker' as const,
      remoteHasTag: vi.fn(async () => true)};
    const r = await runPreflight(baseInput, deps);
    expect(r.ok).toBe(false);
    expect(deps.remoteHasTag).not.toHaveBeenCalled();
  });

  describe('Node engine check', () => {
    it('passes when target has no engines.node', async () => {
      const r = await runPreflight(baseInput, {
        ...baseDeps(), readTargetEnginesNode: vi.fn(async () => null),
      });
      expect(r).toEqual({ok: true});
    });

    it('passes when current Node satisfies the range', async () => {
      const r = await runPreflight(baseInput, {
        ...baseDeps(), readTargetEnginesNode: vi.fn(async () => '>=25.0.0'),
      });
      expect(r).toEqual({ok: true});
    });

    it('fails when current Node is below a future floor (e.g. node 25 vs >=26)', async () => {
      const r = await runPreflight(baseInput, {
        ...baseDeps(), readTargetEnginesNode: vi.fn(async () => '>=26.0.0'),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe('node-engine-mismatch');
        expect(r.detail).toContain('Node >=26.0.0');
        expect(r.detail).toContain('25.0.0');
      }
    });

    it('handles caret ranges', async () => {
      const r = await runPreflight({...baseInput, currentNodeVersion: '24.5.0'}, {
        ...baseDeps(), readTargetEnginesNode: vi.fn(async () => '^25.0.0'),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('node-engine-mismatch');
    });

    it('handles loose ranges with spaces', async () => {
      const r = await runPreflight(baseInput, {
        ...baseDeps(), readTargetEnginesNode: vi.fn(async () => '>= 25.0.0'),
      });
      expect(r).toEqual({ok: true});
    });

    it('runs after signature verification (engine check should not gate trust)', async () => {
      const readEngines = vi.fn(async () => '>=99.0.0');
      const r = await runPreflight(baseInput, {
        ...baseDeps(),
        verifyTag: vi.fn(async (): Promise<VerifyResult> => ({ok: false, reason: 'signature-verification-failed'})),
        readTargetEnginesNode: readEngines,
      });
      expect(r).toEqual({ok: false, reason: 'signature-verification-failed'});
      expect(readEngines).not.toHaveBeenCalled();
    });
  });
});

describe('isPorcelainClean (#8411)', () => {
  it('treats empty output as clean', () => {
    expect(isPorcelainClean('')).toBe(true);
    expect(isPorcelainClean('\n')).toBe(true);
  });

  it('ignores the files the updater writes itself', () => {
    expect(isPorcelainClean([
      '?? var/update.lock',
      '?? var/update-state.json',
      '?? var/update-state.json.tmp',
      '?? var/update-backup/',
      '?? var/log/update.log',
      '?? var/log/update.log.2',
      '',
    ].join('\n'))).toBe(true);
  });

  it('still reports real local changes', () => {
    expect(isPorcelainClean(' M src/node/server.ts\n')).toBe(false);
    expect(isPorcelainClean('?? var/update.lock\n?? notes.txt\n')).toBe(false);
    expect(isPorcelainClean('?? var/update.lock.bak\n')).toBe(false);
    expect(isPorcelainClean('?? var/update-backup-old/\n')).toBe(false);
    expect(isPorcelainClean('?? var/log/other.log\n')).toBe(false);
    expect(isPorcelainClean('?? var/log/update.log.bak\n')).toBe(false);
  });
});

describe('gitWorkingTreeClean (#8411)', () => {
  const sh = (cmd: string, cwd: string) => execSync(cmd, {cwd, stdio: 'pipe'});
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-preflight-'));
    sh('git init -q', dir);
    sh('git config user.email t@example.com', dir);
    sh('git config user.name t', dir);
    sh('git config commit.gpgsign false', dir);
    await fs.mkdir(path.join(dir, 'var'));
    await fs.writeFile(path.join(dir, 'var', '.gitkeep'), '');
    sh('git add . && git commit -q -m init', dir);
  });
  afterEach(async () => {
    await fs.rm(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  });

  it('is clean while the updater holds var/update.lock', async () => {
    await fs.writeFile(path.join(dir, 'var', 'update.lock'), '{"pid":1}');
    await fs.mkdir(path.join(dir, 'var', 'update-backup'));
    await fs.writeFile(path.join(dir, 'var', 'update-backup', 'pnpm-lock.yaml'), 'x');
    expect(await gitWorkingTreeClean(dir)).toBe(true);
  });

  it('is dirty when anything else is untracked or modified', async () => {
    await fs.writeFile(path.join(dir, 'var', 'update.lock'), '{"pid":1}');
    await fs.writeFile(path.join(dir, 'stray.txt'), 'x');
    expect(await gitWorkingTreeClean(dir)).toBe(false);
  });

  it('is dirty when the directory is not a git repo', async () => {
    const notRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-norepo-'));
    try {
      expect(await gitWorkingTreeClean(notRepo)).toBe(false);
    } finally { await fs.rm(notRepo, {recursive: true, force: true}); }
  });
});
