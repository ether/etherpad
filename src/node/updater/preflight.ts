import {InstallMethod} from './types';
import type {VerifyResult} from './trustedKeys';

export type PreflightReason =
  | 'install-method-not-writable'
  | 'dirty-working-tree'
  | 'low-disk-space'
  | 'pnpm-not-found'
  | 'lock-held'
  | 'remote-tag-missing'
  | 'signature-verification-failed';

export interface PreflightInput {
  targetTag: string;
  diskSpaceMinMB: number;
  requireSignature: boolean;
  trustedKeysPath: string | null;
}

export interface PreflightDeps {
  installMethod: Exclude<InstallMethod, 'auto'>;
  workingTreeClean: () => Promise<boolean>;
  freeDiskMB: () => Promise<number>;
  pnpmOnPath: () => Promise<boolean>;
  lockHeld: () => Promise<boolean>;
  remoteHasTag: (tag: string) => Promise<boolean>;
  verifyTag: () => Promise<VerifyResult>;
}

export type PreflightResult = {ok: true} | {ok: false; reason: PreflightReason};

const WRITABLE_METHODS: ReadonlySet<Exclude<InstallMethod, 'auto'>> = new Set(['git']);

/**
 * Sequenced preflight: each check is fast and reads the world. Order matters —
 * cheap, definitive failures (install method) run before slow ones (network
 * tag lookup, gpg). The first failure short-circuits.
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
  return {ok: true};
};
