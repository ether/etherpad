import {spawn} from 'node:child_process';
import semver from 'semver';
import {InstallMethod} from './types';
import type {VerifyResult} from './trustedKeys';

export type PreflightReason =
  | 'install-method-not-writable'
  | 'dirty-working-tree'
  | 'low-disk-space'
  | 'pnpm-not-found'
  | 'lock-held'
  | 'remote-tag-missing'
  | 'signature-verification-failed'
  | 'node-engine-mismatch';

export interface PreflightInput {
  targetTag: string;
  diskSpaceMinMB: number;
  requireSignature: boolean;
  trustedKeysPath: string | null;
  /**
   * Running Node version (typically `process.versions.node`). Threaded
   * through `input` rather than read from globals so the function stays
   * fully testable without process mocking.
   */
  currentNodeVersion: string;
}

export interface PreflightDeps {
  installMethod: Exclude<InstallMethod, 'auto'>;
  workingTreeClean: () => Promise<boolean>;
  freeDiskMB: () => Promise<number>;
  pnpmOnPath: () => Promise<boolean>;
  lockHeld: () => Promise<boolean>;
  remoteHasTag: (tag: string) => Promise<boolean>;
  verifyTag: () => Promise<VerifyResult>;
  /**
   * Returns the `engines.node` field from the target tag's `package.json`
   * without mutating the working tree. The implementation typically runs
   * `git show <tag>:package.json` and parses the JSON. Returns `null` if
   * the field is absent — that's treated as "no constraint, pass".
   */
  readTargetEnginesNode: (tag: string) => Promise<string | null>;
}

export type PreflightResult = {ok: true} | {ok: false; reason: PreflightReason; detail?: string};

/**
 * Paths (relative to the repo root, as `git status --porcelain` prints them)
 * that the updater itself creates or rewrites while it runs. They must never
 * count as local modifications: the pipeline takes `var/update.lock` *before*
 * preflight runs, so an install whose `.gitignore` predates this list would
 * otherwise always fail with `dirty-working-tree` (#8411). Entries ending in
 * `/` match everything below that directory. `var/.gitignore` lists the same
 * paths; this filter is the safety net for older checkouts and custom
 * ignore rules.
 */
export const UPDATER_OWNED_PATHS: readonly string[] = [
  'var/update.lock',
  'var/update-state.json',
  'var/update-state.json.tmp',
  'var/update-backup/',
  'var/log/update.log',
];

// updateLog.ts rotates update.log to update.log.1 … update.log.5.
const ROTATED_UPDATE_LOG = /^var\/log\/update\.log\.\d+$/;

const isUpdaterOwned = (p: string): boolean => ROTATED_UPDATE_LOG.test(p) ||
  UPDATER_OWNED_PATHS.some(
      (owned) => owned.endsWith('/') ? p === owned || p.startsWith(owned) : p === owned);

/**
 * True when `git status --porcelain` output contains nothing but
 * updater-owned paths. Exported for tests.
 */
export const isPorcelainClean = (porcelain: string): boolean => porcelain
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim().length > 0)
    // Porcelain v1: two status columns, a space, then the path.
    .every((l) => isUpdaterOwned(l.slice(3)));

/** Runs `git status --porcelain` in `repoDir` and applies `isPorcelainClean`. */
export const gitWorkingTreeClean = (repoDir: string): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const c = spawn('git', ['status', '--porcelain'], {cwd: repoDir});
    let out = '';
    c.stdout.on('data', (b) => { out += b.toString(); });
    c.on('close', (code) => resolve(code === 0 && isPorcelainClean(out)));
    c.on('error', () => resolve(false));
  });

const WRITABLE_METHODS: ReadonlySet<Exclude<InstallMethod, 'auto'>> = new Set(['git']);

/**
 * Sequenced preflight: each check is fast and reads the world. Order matters —
 * cheap, definitive failures (install method) run before slow ones (network
 * tag lookup, gpg). The first failure short-circuits.
 *
 * The Node-engine check runs *after* signature verification: we want the
 * range to come from a trusted tag. It runs *before* anything mutates the
 * working tree (the executor does the first `git checkout` after we return
 * ok), so a failure leaves the system exactly as it was — no rollback needed.
 */
export const runPreflight = async (
  input: PreflightInput,
  deps: PreflightDeps,
): Promise<PreflightResult> => {
  if (!WRITABLE_METHODS.has(deps.installMethod)) {
    return {ok: false, reason: 'install-method-not-writable'};
  }
  if (!await deps.workingTreeClean()) return {ok: false, reason: 'dirty-working-tree'};
  if ((await deps.freeDiskMB()) < input.diskSpaceMinMB) return {ok: false, reason: 'low-disk-space'};
  if (!await deps.pnpmOnPath()) return {ok: false, reason: 'pnpm-not-found'};
  if (await deps.lockHeld()) return {ok: false, reason: 'lock-held'};
  if (!await deps.remoteHasTag(input.targetTag)) return {ok: false, reason: 'remote-tag-missing'};
  const sig = await deps.verifyTag();
  if (!sig.ok) return {ok: false, reason: 'signature-verification-failed'};

  const range = await deps.readTargetEnginesNode(input.targetTag);
  if (range && !semver.satisfies(input.currentNodeVersion, range, {includePrerelease: true})) {
    return {
      ok: false,
      reason: 'node-engine-mismatch',
      detail: `target requires Node ${range}, running ${input.currentNodeVersion}`,
    };
  }

  return {ok: true};
};
