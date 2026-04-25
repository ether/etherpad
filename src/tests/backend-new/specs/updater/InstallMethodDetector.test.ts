import {describe, it, expect, beforeEach} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {detectInstallMethod} from '../../../../node/updater/InstallMethodDetector';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'detector-'));
});

const opts = (override?: 'auto' | 'git' | 'docker' | 'npm' | 'managed') => ({
  override: override ?? 'auto',
  rootDir: dir,
  dockerEnvPath: path.join(dir, '.dockerenv'),
});

describe('detectInstallMethod', () => {
  it('honors a non-auto override', async () => {
    expect(await detectInstallMethod(opts('git'))).toBe('git');
    expect(await detectInstallMethod(opts('docker'))).toBe('docker');
    expect(await detectInstallMethod(opts('managed'))).toBe('managed');
  });

  it('returns docker when /.dockerenv exists', async () => {
    await fs.writeFile(opts().dockerEnvPath, '');
    expect(await detectInstallMethod(opts())).toBe('docker');
  });

  it('returns git when .git is present and root is writable', async () => {
    await fs.mkdir(path.join(dir, '.git'));
    expect(await detectInstallMethod(opts())).toBe('git');
  });

  it('returns npm when package-lock.json is present and writable', async () => {
    await fs.writeFile(path.join(dir, 'package-lock.json'), '{}');
    expect(await detectInstallMethod(opts())).toBe('npm');
  });

  it('returns managed when nothing matches', async () => {
    expect(await detectInstallMethod(opts())).toBe('managed');
  });

  it('docker takes precedence over git', async () => {
    await fs.writeFile(opts().dockerEnvPath, '');
    await fs.mkdir(path.join(dir, '.git'));
    expect(await detectInstallMethod(opts())).toBe('docker');
  });
});
