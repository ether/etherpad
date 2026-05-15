import {describe, it, expect, vi} from 'vitest';
import {runPreflight, PreflightDeps} from '../../../../node/updater/preflight';
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
