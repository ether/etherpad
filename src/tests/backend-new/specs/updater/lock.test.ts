import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {acquireLock, releaseLock, isHeld} from '../../../../node/updater/lock.js';

describe('update lock', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-lock-'));
    lockPath = path.join(dir, 'update.lock');
  });

  afterEach(async () => {
    await fs.rm(dir, {recursive: true, force: true});
  });

  it('acquires and releases', async () => {
    expect(await acquireLock(lockPath)).toBe(true);
    expect(await isHeld(lockPath)).toBe(true);
    await releaseLock(lockPath);
    expect(await isHeld(lockPath)).toBe(false);
  });

  it('rejects a second acquire while live', async () => {
    expect(await acquireLock(lockPath)).toBe(true);
    expect(await acquireLock(lockPath)).toBe(false);
    await releaseLock(lockPath);
  });

  it('reaps a stale lock whose PID is gone', async () => {
    // Pick a PID that almost certainly does not exist. process.kill(pid, 0) on
    // a free PID returns ESRCH which the implementation treats as stale.
    await fs.writeFile(lockPath, JSON.stringify({pid: 2147483646, at: new Date().toISOString()}));
    expect(await acquireLock(lockPath)).toBe(true);
    await releaseLock(lockPath);
  });

  it('treats an unparseable lock file as stale', async () => {
    await fs.writeFile(lockPath, 'garbage');
    expect(await acquireLock(lockPath)).toBe(true);
    await releaseLock(lockPath);
  });

  it('treats a lock missing required fields as stale', async () => {
    await fs.writeFile(lockPath, JSON.stringify({somethingElse: true}));
    expect(await acquireLock(lockPath)).toBe(true);
    await releaseLock(lockPath);
  });

  it('release is idempotent (no error when file absent)', async () => {
    await releaseLock(lockPath); // file never existed
    expect(await isHeld(lockPath)).toBe(false);
  });

  it('isHeld returns false for a stale lock', async () => {
    await fs.writeFile(lockPath, JSON.stringify({pid: 2147483646, at: new Date().toISOString()}));
    expect(await isHeld(lockPath)).toBe(false);
  });

  it('creates parent directory if missing', async () => {
    const nested = path.join(dir, 'a', 'b', 'update.lock');
    expect(await acquireLock(nested)).toBe(true);
    expect(await isHeld(nested)).toBe(true);
    await releaseLock(nested);
  });
});
