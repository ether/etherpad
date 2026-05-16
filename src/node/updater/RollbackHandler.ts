import path from 'node:path';
import log4js from 'log4js';
import {UpdateState} from './types.js';
import type {SpawnFn} from './UpdateExecutor.js';
import {appendLine} from './updateLog.js';

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
  let settled = false;
  const settle = (c: number | null) => {
    if (settled) return;
    settled = true;
    resolve(c);
  };
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
  // Spawn failures (binary missing, permissions) — without this listener the
  // promise hangs forever and the rollback path never lands on terminal state.
  child.on('error', (err: Error) => {
    logger.error(`[rollback ${tag}] spawn error: ${err.message}`);
    appendLine(logPath, `[${new Date().toISOString()}] rollback ${tag} SPAWN_ERR | ${err.message}`);
    settle(1);
  });
  child.on('close', (c) => settle(c));
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

  // Fire-and-forget helpers that swallow rejections cleanly. We intentionally
  // don't propagate — the boot sequence must proceed even if the rollback
  // path can't write its terminal state. Worst case: the supervisor restart
  // brings the same boot back up and the bootCount-based crash-loop guard
  // catches it on the next attempt.
  const fireRollback = (s: UpdateState) => {
    void performRollback(s, deps).catch((err) => {
      logger.error(`performRollback unhandled rejection: ${(err as Error).message}`);
      // Best-effort: try to land on rollback-failed terminal state and exit
      // 75 anyway. If saveState also rejects, log and exit so the supervisor
      // restart at least re-runs checkPendingVerification with bootCount++.
      const fb = {
        ...s,
        execution: {
          status: 'rollback-failed' as const,
          reason: `unhandled rollback rejection: ${(err as Error).message}`,
          targetTag: (s.execution as {targetTag?: string}).targetTag ?? '',
          fromSha: (s.execution as {fromSha?: string}).fromSha ?? '',
          at: deps.now().toISOString(),
        },
        bootCount: 0,
      };
      void deps.saveState(fb).catch((saveErr) => {
        logger.error(`fallback saveState rejected: ${(saveErr as Error).message}`);
      }).finally(() => deps.exit(75));
    });
  };

  const fireSaveState = (s: UpdateState, ctx: string) => {
    void deps.saveState(s).catch((err) => {
      logger.warn(`saveState (${ctx}) rejected: ${(err as Error).message}`);
    });
  };

  if (state.bootCount > 2) {
    // Don't await — fire and forget so the boot sequence proceeds; the rollback
    // path will exit 75 asynchronously and the supervisor restarts on the
    // restored SHA. Rejections caught + best-effort terminal-state write.
    fireRollback(state);
    return {armed: false, markVerified: () => {}};
  }

  const incremented: UpdateState = {...state, bootCount: state.bootCount + 1};
  fireSaveState(incremented, 'bootCount-increment');

  let cleared = false;
  const timer = setTimeout(() => {
    if (cleared) return;
    fireRollback({
      ...incremented,
      execution: {
        status: 'rolling-back',
        reason: 'health-check-timeout',
        targetTag: exec.targetTag,
        fromSha: exec.fromSha,
        at: deps.now().toISOString(),
      },
    });
  }, deps.rollbackHealthCheckSeconds * 1000);

  return {
    armed: true,
    markVerified: () => {
      if (cleared) return;
      cleared = true;
      clearTimeout(timer);
      const at = deps.now().toISOString();
      fireSaveState({
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
      }, 'mark-verified');
      logger.info(`update verified after restart: ${exec.fromSha} -> ${exec.targetTag}`);
    },
  };
};
