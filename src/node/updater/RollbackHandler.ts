import path from 'node:path';
import log4js from 'log4js';
import {UpdateState} from './types';
import type {SpawnFn} from './UpdateExecutor';
import {appendLine} from './updateLog';

const logger = log4js.getLogger('updater');

export interface RollbackDeps {
  /** Path of the on-disk Etherpad install (the git working tree). */
  repoDir: string;
  /** Where pnpm-lock.yaml was backed up by the executor. */
  backupDir: string;
  spawnFn: SpawnFn;
  copyFile: (src: string, dst: string) => Promise<void>;
  saveState: (s: UpdateState) => Promise<void>;
  exit: (code: number) => void;
  now: () => Date;
  /** Health-check window after a fresh boot. Default 60s; set via updates.rollbackHealthCheckSeconds. */
  rollbackHealthCheckSeconds: number;
}

const runStep = (
  spawnFn: SpawnFn,
  cwd: string,
  logPath: string,
  cmd: string,
  args: string[],
): Promise<number | null> => new Promise((resolve) => {
  const child = spawnFn(cmd, args, {cwd, stdio: ['ignore', 'pipe', 'pipe']});
  const tag = `${cmd} ${args.join(' ')}`;
  child.stdout.on('data', (b: Buffer) => {
    const t = b.toString().trimEnd();
    logger.info(`[rollback ${tag}] ${t}`);
    appendLine(logPath, `[${new Date().toISOString()}] rollback ${tag} | ${t}`);
  });
  child.stderr.on('data', (b: Buffer) => {
    const t = b.toString().trimEnd();
    logger.warn(`[rollback ${tag}] ${t}`);
    appendLine(logPath, `[${new Date().toISOString()}] rollback ${tag} ERR | ${t}`);
  });
  child.on('close', (c) => resolve(c));
});

/**
 * Restore the previous SHA + lockfile and exit 75 so the supervisor restarts.
 *
 * Lands on `rolled-back` on success, `rollback-failed` on any sub-step error.
 * Both paths exit 75 — the supervisor restart is what brings the rolled-back
 * (or terminal) state up where the admin UI can surface it. Rollback-failed
 * disables auto/autonomous tiers globally (see UpdatePolicy) until an admin
 * POSTs /admin/update/acknowledge.
 */
export const performRollback = async (state: UpdateState, deps: RollbackDeps): Promise<void> => {
  const exec = state.execution;
  if (exec.status !== 'rolling-back' && exec.status !== 'pending-verification') {
    throw new Error(`performRollback called from unexpected status: ${exec.status}`);
  }
  const fromSha = (exec as {fromSha: string}).fromSha;
  const targetTag = (exec as {targetTag: string}).targetTag;
  const reason = exec.status === 'rolling-back'
    ? exec.reason
    : 'health-check-failed-or-crash-loop';
  const logPath = path.join(deps.repoDir, 'var', 'log', 'update.log');

  const failTerminal = async (subReason: string): Promise<void> => {
    const at = deps.now().toISOString();
    await deps.saveState({
      ...state,
      execution: {
        status: 'rollback-failed',
        reason: `${reason}; rollback also failed: ${subReason}`,
        targetTag,
        fromSha,
        at,
      },
      lastResult: {
        targetTag,
        fromSha,
        outcome: 'rollback-failed',
        reason: `${reason}; rollback failed: ${subReason}`,
        at,
      },
      bootCount: 0,
    });
    logger.error(
      `rollback FAILED: ${subReason}; manual intervention required ` +
      '(POST /admin/update/acknowledge after fixing)',
    );
    appendLine(logPath, `[${at}] ROLLBACK_FAILED ${subReason}`);
    deps.exit(75);
  };

  // Force-checkout first so any partial mutation from the failed executor run
  // (rewritten lockfile, half-installed modules) is discarded. -f overwrites
  // tracked files from the target tree's index — without it, `git checkout`
  // refuses when there are unstaged modifications to files it would replace.
  const checkoutCode = await runStep(
    deps.spawnFn, deps.repoDir, logPath, 'git', ['checkout', '-f', fromSha]);
  if (checkoutCode !== 0) return failTerminal(`git checkout -f ${fromSha} exit ${checkoutCode}`);

  // Now overlay the backed-up lockfile on top. Belt-and-braces: a force
  // checkout already restored the lockfile to the target SHA's version; the
  // backup wins on the rare case where the running install had a hand-edited
  // lockfile we want to preserve.
  try {
    await deps.copyFile(
      path.join(deps.backupDir, 'pnpm-lock.yaml'),
      path.join(deps.repoDir, 'pnpm-lock.yaml'),
    );
  } catch (err: any) {
    // ENOENT on the backup is acceptable — the force checkout already
    // restored the right lockfile from the index.
    if (err?.code !== 'ENOENT') {
      return failTerminal(`copy lockfile: ${(err as Error).message}`);
    }
  }

  const installCode = await runStep(deps.spawnFn, deps.repoDir, logPath, 'pnpm', ['install', '--frozen-lockfile']);
  if (installCode !== 0) return failTerminal(`pnpm install exit ${installCode}`);

  const at = deps.now().toISOString();
  await deps.saveState({
    ...state,
    execution: {status: 'rolled-back', reason, targetTag, restoredSha: fromSha, at},
    lastResult: {targetTag, fromSha, outcome: 'rolled-back', reason, at},
    bootCount: 0,
  });
  logger.warn(`rolled back to ${fromSha} (reason: ${reason})`);
  appendLine(logPath, `[${at}] ROLLED_BACK to ${fromSha}; reason=${reason}; exiting 75`);
  deps.exit(75);
};

export interface CheckResult {
  /** True if a health-check timer was armed and is awaiting markVerified or expiry. */
  armed: boolean;
  /** Cancels the timer and transitions to `verified`. No-op when armed is false. */
  markVerified: () => void;
}

/**
 * Inspect the persisted execution state at boot and react:
 *  - idle / verified / etc.: no-op.
 *  - pending-verification with bootCount > 2: force rollback (crash-loop guard).
 *  - pending-verification otherwise: increment bootCount, persist, arm a timer.
 */
export const checkPendingVerification = (state: UpdateState, deps: RollbackDeps): CheckResult => {
  const exec = state.execution;
  if (exec.status !== 'pending-verification') return {armed: false, markVerified: () => {}};

  if (state.bootCount > 2) {
    // Don't await — fire and forget so the boot sequence proceeds; the rollback
    // path will exit 75 asynchronously and the supervisor restarts on the
    // restored SHA.
    void performRollback(state, deps);
    return {armed: false, markVerified: () => {}};
  }

  const incremented: UpdateState = {...state, bootCount: state.bootCount + 1};
  void deps.saveState(incremented);

  let cleared = false;
  const timer = setTimeout(() => {
    if (cleared) return;
    void performRollback({
      ...incremented,
      execution: {
        status: 'rolling-back',
        reason: 'health-check-timeout',
        targetTag: exec.targetTag,
        fromSha: exec.fromSha,
        at: deps.now().toISOString(),
      },
    }, deps);
  }, deps.rollbackHealthCheckSeconds * 1000);

  return {
    armed: true,
    markVerified: () => {
      if (cleared) return;
      cleared = true;
      clearTimeout(timer);
      const at = deps.now().toISOString();
      void deps.saveState({
        ...incremented,
        execution: {status: 'verified', targetTag: exec.targetTag, verifiedAt: at},
        lastResult: {
          targetTag: exec.targetTag,
          fromSha: exec.fromSha,
          outcome: 'verified',
          reason: null,
          at,
        },
        bootCount: 0,
      });
      logger.info(`update verified after restart: ${exec.fromSha} -> ${exec.targetTag}`);
    },
  };
};
