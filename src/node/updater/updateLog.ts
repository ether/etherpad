import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_BACKUPS = 5;

/**
 * Rotate `<logPath>` when it exceeds `maxBytes`:
 *   <logPath>.{n-1} -> .n  (oldest dropped)
 *   <logPath>       -> .1
 * No-op when the file is missing or under the limit.
 */
export const rotateIfNeeded = async (
  logPath: string,
  maxBytes = DEFAULT_MAX_BYTES,
  backups = DEFAULT_BACKUPS,
): Promise<void> => {
  let size = 0;
  try { size = (await fs.stat(logPath)).size; } catch (err: any) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  if (size < maxBytes) return;

  // Drop the oldest. Walk from highest index down so the rename chain lands cleanly.
  for (let i = backups - 1; i >= 1; i--) {
    const src = `${logPath}.${i}`;
    const dst = `${logPath}.${i + 1}`;
    try { await fs.rename(src, dst); }
    catch (err: any) { if (err.code !== 'ENOENT') throw err; }
  }
  // Current file becomes .1.
  try { await fs.rename(logPath, `${logPath}.1`); }
  catch (err: any) { if (err.code !== 'ENOENT') throw err; }
};

/**
 * Append `line` to `<logPath>`, rotating first if the file is over the size cap.
 * Creates parent directories as needed. The line is newline-terminated; do not
 * include a trailing newline in `line`.
 */
export const appendLine = async (
  logPath: string,
  line: string,
  maxBytes = DEFAULT_MAX_BYTES,
  backups = DEFAULT_BACKUPS,
): Promise<void> => {
  await fs.mkdir(path.dirname(logPath), {recursive: true});
  await rotateIfNeeded(logPath, maxBytes, backups);
  await fs.appendFile(logPath, `${line}\n`);
};

/** Read the last `n` newline-separated lines from the active log file. Empty array if missing. */
export const tailLines = async (logPath: string, n: number): Promise<string[]> => {
  if (n <= 0) return [];
  let raw: string;
  try { raw = await fs.readFile(logPath, 'utf8'); }
  catch (err: any) { if (err.code === 'ENOENT') return []; throw err; }
  const stripped = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  if (stripped.length === 0) return [];
  const all = stripped.split('\n');
  return all.slice(Math.max(0, all.length - n));
};
