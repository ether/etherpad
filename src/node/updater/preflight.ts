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
