import fs from 'node:fs/promises';
import path from 'node:path';

interface LockFile {
  pid: number;
  at: string;
}

const isPidLive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // ESRCH = no such process (stale).
    // EPERM = exists but we can't signal — treat as live (some other user owns it).
    return err.code !== 'ESRCH';
  }
};

const readIfPresent = async (lockPath: string): Promise<LockFile | null> => {
  let raw: string;
  try {
    raw = await fs.readFile(lockPath, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    return null;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.pid !== 'number' || typeof p.at !== 'string') return null;
  return {pid: p.pid, at: p.at};
};

/**
 * Atomic acquire via O_CREAT|O_EXCL. If the file already exists, the holder's
 * PID is checked; when dead we reap it and retry once. Returns false on a live
 * conflict — the caller is expected to surface "lock-held" to the admin.
 */
export const acquireLock = async (lockPath: string): Promise<boolean> => {
  await fs.mkdir(path.dirname(lockPath), {recursive: true});
  const payload = JSON.stringify({pid: process.pid, at: new Date().toISOString()});

  const tryCreate = async (): Promise<boolean> => {
    try {
      const fh = await fs.open(lockPath, 'wx');
      try { await fh.writeFile(payload); } finally { await fh.close(); }
      return true;
    } catch (err: any) {
      if (err.code === 'EEXIST') return false;
      throw err;
    }
  };

  if (await tryCreate()) return true;

  const existing = await readIfPresent(lockPath);
  if (existing && isPidLive(existing.pid)) return false;

  // Stale or unparseable — reap and retry once. A concurrent reaper may beat us,
  // in which case the second tryCreate also returns false (correctly: someone
  // else holds it now).
  try { await fs.unlink(lockPath); }
  catch (err: any) { if (err.code !== 'ENOENT') throw err; }
  return tryCreate();
};

export const releaseLock = async (lockPath: string): Promise<void> => {
  try { await fs.unlink(lockPath); }
  catch (err: any) { if (err.code !== 'ENOENT') throw err; }
};

/** True iff the lock file exists *and* the recorded PID is live. Stale locks read as not-held. */
export const isHeld = async (lockPath: string): Promise<boolean> => {
  const f = await readIfPresent(lockPath);
  return !!f && isPidLive(f.pid);
};
