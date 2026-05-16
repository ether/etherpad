import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {tailLines} from '../../../../node/updater/updateLog';

describe('tailLines', () => {
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-log-'));
    logPath = path.join(dir, 'update.log');
  });

  afterEach(async () => {
    await fs.rm(dir, {recursive: true, force: true});
  });

  it('returns [] when file is missing', async () => {
    expect(await tailLines(logPath, 10)).toEqual([]);
  });

  it('returns [] for an empty file', async () => {
    await fs.writeFile(logPath, '');
    expect(await tailLines(logPath, 10)).toEqual([]);
  });

  it('returns up to N lines when file is shorter', async () => {
    await fs.writeFile(logPath, 'a\nb\nc\n');
    expect(await tailLines(logPath, 10)).toEqual(['a', 'b', 'c']);
  });

  it('returns the last N when file is longer', async () => {
    const lines = Array.from({length: 500}, (_, i) => `line-${i}`);
    await fs.writeFile(logPath, lines.join('\n') + '\n');
    expect(await tailLines(logPath, 5)).toEqual([
      'line-495', 'line-496', 'line-497', 'line-498', 'line-499',
    ]);
  });

  it('handles a final-line-without-newline', async () => {
    await fs.writeFile(logPath, 'a\nb\nc');
    expect(await tailLines(logPath, 10)).toEqual(['a', 'b', 'c']);
  });

  it('handles n=0', async () => {
    await fs.writeFile(logPath, 'a\nb\nc\n');
    expect(await tailLines(logPath, 0)).toEqual([]);
  });
});

describe('appendLine + rotation', () => {
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-log-'));
    logPath = path.join(dir, 'update.log');
  });
  afterEach(async () => { await fs.rm(dir, {recursive: true, force: true}); });

  it('appendLine creates parent dir and writes a newline-terminated line', async () => {
    const {appendLine} = await import('../../../../node/updater/updateLog');
    const nested = path.join(dir, 'a', 'b', 'update.log');
    await appendLine(nested, 'hello world');
    expect(await fs.readFile(nested, 'utf8')).toBe('hello world\n');
  });

  it('appendLine swallows errors so the caller never breaks on a read-only fs', async () => {
    const {appendLine} = await import('../../../../node/updater/updateLog');
    // Make the would-be parent dir a regular file — fs.mkdir then fails with ENOTDIR
    // (or EEXIST depending on platform), which the helper must swallow.
    const collide = path.join(dir, 'not-a-dir');
    await fs.writeFile(collide, 'oops');
    const target = path.join(collide, 'inner', 'update.log');
    await appendLine(target, 'x'); // must NOT throw
  });

  it('rotateIfNeeded shifts .1 -> .2, current -> .1 once over the size threshold', async () => {
    const {rotateIfNeeded} = await import('../../../../node/updater/updateLog');
    // Force rotation by passing a tiny limit; write a line above the limit.
    await fs.writeFile(logPath, 'a'.repeat(50));
    await rotateIfNeeded(logPath, 10, 3);
    expect(await fs.readFile(`${logPath}.1`, 'utf8')).toBe('a'.repeat(50));
    // Original file is gone (or empty after rotation).
    let exists = true;
    try { await fs.access(logPath); } catch { exists = false; }
    expect(exists).toBe(false);
  });

  it('rotateIfNeeded preserves up to BACKUPS-1 older backups', async () => {
    const {rotateIfNeeded} = await import('../../../../node/updater/updateLog');
    await fs.writeFile(logPath, 'newest'.repeat(20));
    await fs.writeFile(`${logPath}.1`, 'older-1');
    await fs.writeFile(`${logPath}.2`, 'older-2');
    await rotateIfNeeded(logPath, 10, 3);
    expect(await fs.readFile(`${logPath}.1`, 'utf8')).toBe('newest'.repeat(20));
    expect(await fs.readFile(`${logPath}.2`, 'utf8')).toBe('older-1');
    expect(await fs.readFile(`${logPath}.3`, 'utf8')).toBe('older-2');
  });

  it('rotateIfNeeded is a no-op when under the limit', async () => {
    const {rotateIfNeeded} = await import('../../../../node/updater/updateLog');
    await fs.writeFile(logPath, 'small');
    await rotateIfNeeded(logPath, 10 * 1024 * 1024, 3);
    expect(await fs.readFile(logPath, 'utf8')).toBe('small');
    let backupExists = true;
    try { await fs.access(`${logPath}.1`); } catch { backupExists = false; }
    expect(backupExists).toBe(false);
  });
});
