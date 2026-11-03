import {describe, expect, it} from 'vitest';
import {isWorkingTreeDirty, parsePorcelainPaths} from '../../../../node/updater/gitStatus';

describe('git status parsing for the updater preflight', () => {
  it('treats empty output as clean', () => {
    expect(parsePorcelainPaths('')).toEqual([]);
    expect(isWorkingTreeDirty('')).toBe(false);
  });

  it('ignores the lock file the updater takes before preflight (#8411)', () => {
    // applyUpdate acquires the lock before it runs the dirty-working-tree check,
    // so the lock always shows up as untracked and used to block every apply.
    expect(parsePorcelainPaths('?? var/update.lock\n')).toEqual([]);
    expect(isWorkingTreeDirty('?? var/update.lock\n')).toBe(false);
  });

  it('still reports real changes next to the lock file', () => {
    const out = ' M src/node/updater/index.ts\n?? var/update.lock\n';
    expect(parsePorcelainPaths(out)).toEqual(['src/node/updater/index.ts']);
    expect(isWorkingTreeDirty(out)).toBe(true);
  });

  it('handles CRLF output', () => {
    expect(isWorkingTreeDirty('?? var/update.lock\r\n')).toBe(false);
    expect(isWorkingTreeDirty('?? stray.txt\r\n')).toBe(true);
  });

  it('unquotes paths that git escaped', () => {
    expect(parsePorcelainPaths('?? "a file with spaces.txt"\n')).toEqual(['a file with spaces.txt']);
  });

  it('does not ignore a path that merely ends with the lock name', () => {
    expect(parsePorcelainPaths('?? var/update.lock \n')).toEqual(['var/update.lock ']);
    expect(parsePorcelainPaths('?? "var/update.lock "\n')).toEqual(['var/update.lock ']);
  });
});
