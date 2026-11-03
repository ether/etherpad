import {spawn} from 'node:child_process';

/**
 * Paths the updater writes into the working tree itself. They must never count
 * as dirt: `applyUpdate` takes the lock before it runs preflight, so a plain
 * `git status` always sees `var/update.lock` and every apply fails with
 * `dirty-working-tree` (#8411).
 *
 * `var/.gitignore` covers these too. The filter here is the belt to that
 * braces: an install that has not picked up the updated `.gitignore` yet still
 * sees the file as untracked.
 */
export const UPDATER_OWNED_PATHS: readonly string[] = ['var/update.lock'];

/**
 * Extract the paths that are really dirty from `git status --porcelain` output.
 * Each line is `XY <path>`, where `XY` is a two-character status code. Rename
 * entries look like `R  <old> -> <new>`; the old path is the one reported.
 */
export const parsePorcelainPaths = (porcelain: string): string[] =>
  porcelain
      .split('\n')
      // Only the CRLF terminator is stripped: a path may legitimately end in a
      // space, and trimming it would make `var/update.lock ` look like the lock.
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line.length > 3)
      .map((line) => line.slice(3).replace(/^"(.*)"$/, '$1'))
      .filter((path) => !UPDATER_OWNED_PATHS.includes(path));

export const isWorkingTreeDirty = (porcelain: string): boolean =>
  parsePorcelainPaths(porcelain).length > 0;

/** Resolves true when `git status` reports nothing but the updater's own files. */
export const checkWorkingTreeClean = (repoDir: string): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const c = spawn('git', ['status', '--porcelain'], {cwd: repoDir});
    let out = '';
    c.stdout.on('data', (b: Buffer) => { out += b.toString(); });
    c.on('close', () => resolve(!isWorkingTreeDirty(out)));
    c.on('error', () => resolve(false));
  });
