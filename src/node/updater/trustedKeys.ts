import {spawn as realSpawn, SpawnOptions} from 'node:child_process';
import log4js from 'log4js';

const logger = log4js.getLogger('updater');

export type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => {
  on: (event: 'close', cb: (code: number | null) => void) => void;
};

export interface VerifyArgs {
  tag: string;
  repoDir: string;
  requireSignature: boolean;
  trustedKeysPath: string | null;
  /** Override for tests; production callers use the default `child_process.spawn`. */
  spawnFn?: SpawnFn;
}

export type VerifyResult =
  | {ok: true; reason: 'signature-verified' | 'signature-not-required'}
  | {ok: false; reason: 'signature-verification-failed'};

/**
 * Verify a release tag's GPG signature via `git verify-tag <tag>`.
 *
 * With `requireSignature: false` (default) this is a documented no-op:
 * Etherpad's release process does not yet sign tags consistently, and
 * forcing verification on by default would break Tier 2 for everyone.
 * Admins who run their own builds or who pin to signed forks set
 * `updates.requireSignature: true` and import the trusted keys into the
 * Etherpad user's keyring (or a dedicated keyring at
 * `updates.trustedKeysPath`, which is passed to git via $GNUPGHOME).
 */
export const verifyReleaseTag = async (args: VerifyArgs): Promise<VerifyResult> => {
  if (!args.requireSignature) {
    logger.warn(
      `verifyReleaseTag: signature check skipped (updates.requireSignature=false) for ${args.tag}`,
    );
    return {ok: true, reason: 'signature-not-required'};
  }
  const spawnFn = args.spawnFn ?? (realSpawn as unknown as SpawnFn);
  const env: NodeJS.ProcessEnv = {...process.env};
  if (args.trustedKeysPath) env.GNUPGHOME = args.trustedKeysPath;
  const child = spawnFn('git', ['verify-tag', args.tag], {
    cwd: args.repoDir,
    env,
    stdio: 'ignore',
  });
  const code: number | null = await new Promise((resolve) => child.on('close', resolve));
  if (code === 0) return {ok: true, reason: 'signature-verified'};
  logger.error(`verifyReleaseTag: git verify-tag ${args.tag} exited ${code}`);
  return {ok: false, reason: 'signature-verification-failed'};
};
