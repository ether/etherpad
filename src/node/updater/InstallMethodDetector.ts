import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import path from 'node:path';
import {InstallMethod} from './types';

export interface DetectOptions {
  /** Setting from settings.json. "auto" means detect; anything else is forced. */
  override: InstallMethod;
  /** Root directory of the Etherpad install. */
  rootDir: string;
  /** Path to /.dockerenv (overridable for tests). */
  dockerEnvPath?: string;
}

const exists = async (p: string): Promise<boolean> => {
  try { await fs.access(p, fsConstants.F_OK); return true; } catch { return false; }
};

const writable = async (p: string): Promise<boolean> => {
  try { await fs.access(p, fsConstants.W_OK); return true; } catch { return false; }
};

/**
 * Detect how Etherpad was installed. Returns 'docker' | 'git' | 'npm' | 'managed'.
 * - If `opts.override` is anything other than 'auto', that value is returned unchanged.
 * - 'docker' is checked first via `/.dockerenv` (overridable for tests).
 * - 'git' requires both a `.git` dir AND a writable rootDir (so we don't try to update read-only checkouts).
 * - 'npm' requires a writable `package-lock.json`.
 * - 'managed' is the catch-all for installs we can't safely modify.
 */
export const detectInstallMethod = async (
  opts: DetectOptions,
): Promise<Exclude<InstallMethod, 'auto'>> => {
  if (opts.override !== 'auto') return opts.override;

  const dockerEnv = opts.dockerEnvPath ?? '/.dockerenv';
  if (await exists(dockerEnv)) return 'docker';

  const gitDir = path.join(opts.rootDir, '.git');
  if (await exists(gitDir) && await writable(opts.rootDir)) return 'git';

  const lockfile = path.join(opts.rootDir, 'package-lock.json');
  if (await exists(lockfile) && await writable(lockfile)) return 'npm';

  return 'managed';
};
