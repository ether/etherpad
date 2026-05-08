import {describe, it, expect, vi} from 'vitest';
import {verifyReleaseTag} from '../../../../node/updater/trustedKeys';

const fakeChild = (exitCode: number) => ({
  on: (e: string, cb: any) => { if (e === 'close') setImmediate(() => cb(exitCode)); },
});

describe('verifyReleaseTag', () => {
  it('returns ok with reason "signature-not-required" when requireSignature is false (no spawn)', async () => {
    const spawnFn = vi.fn();
    const r = await verifyReleaseTag({
      tag: 'v2.7.3',
      repoDir: '/tmp/x',
      requireSignature: false,
      trustedKeysPath: null,
      spawnFn: spawnFn as any,
    });
    expect(r).toEqual({ok: true, reason: 'signature-not-required'});
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('returns ok on git verify-tag exit 0', async () => {
    const spawnFn = vi.fn(() => fakeChild(0));
    const r = await verifyReleaseTag({
      tag: 'v2.7.3',
      repoDir: '/tmp/x',
      requireSignature: true,
      trustedKeysPath: null,
      spawnFn: spawnFn as any,
    });
    expect(r).toEqual({ok: true, reason: 'signature-verified'});
    expect(spawnFn).toHaveBeenCalledWith(
      'git',
      // -- terminates options so a future tag-validation regression can't
      // smuggle a flag past git verify-tag.
      ['verify-tag', '--', 'v2.7.3'],
      expect.objectContaining({cwd: '/tmp/x'}),
    );
  });

  it('returns failure on non-zero exit', async () => {
    const spawnFn = vi.fn(() => fakeChild(1));
    const r = await verifyReleaseTag({
      tag: 'v2.7.3',
      repoDir: '/tmp/x',
      requireSignature: true,
      trustedKeysPath: null,
      spawnFn: spawnFn as any,
    });
    expect(r).toEqual({ok: false, reason: 'signature-verification-failed'});
  });

  it('passes GNUPGHOME when trustedKeysPath is set', async () => {
    const calls: any[] = [];
    const spawnFn = vi.fn((cmd: string, args: string[], opts: any) => {
      calls.push({cmd, args, env: opts.env});
      return fakeChild(0);
    });
    await verifyReleaseTag({
      tag: 'v2.7.3',
      repoDir: '/tmp/x',
      requireSignature: true,
      trustedKeysPath: '/srv/etherpad/keys',
      spawnFn: spawnFn as any,
    });
    expect(calls[0].env.GNUPGHOME).toBe('/srv/etherpad/keys');
  });

  it('refuses unsafe tags (option-injection guard) before spawning git', async () => {
    const spawnFn = vi.fn();
    const r = await verifyReleaseTag({
      tag: '-no-verify',
      repoDir: '/tmp/x',
      requireSignature: true,
      trustedKeysPath: null,
      spawnFn: spawnFn as any,
    });
    expect(r).toEqual({ok: false, reason: 'signature-verification-failed'});
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('does not set GNUPGHOME when trustedKeysPath is null', async () => {
    const calls: any[] = [];
    const spawnFn = vi.fn((cmd: string, args: string[], opts: any) => {
      calls.push({cmd, args, env: opts.env});
      return fakeChild(0);
    });
    delete process.env.GNUPGHOME;
    await verifyReleaseTag({
      tag: 'v2.7.3',
      repoDir: '/tmp/x',
      requireSignature: true,
      trustedKeysPath: null,
      spawnFn: spawnFn as any,
    });
    expect(calls[0].env.GNUPGHOME).toBeUndefined();
  });
});
