import path from 'node:path';
import log4js from 'log4js';
import {SpawnOptions} from 'node:child_process';
import {UpdateState} from './types';
import {appendLine} from './updateLog';
import {assertValidTag, refsTagsForm} from './refSafety';
import {pnpmInvocation, PnpmCommand} from './pnpm';

const logger = log4js.getLogger('updater');

export interface SpawnedChild {
  stdout: {on: (event: 'data', cb: (chunk: Buffer) => void) => void};
  stderr: {on: (event: 'data', cb: (chunk: Buffer) => void) => void};
  on: {
    (event: 'close', cb: (code: number | null) => void): void;
    (event: 'error', cb: (err: Error) => void): void;
  };
}

export type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => SpawnedChild;

export interface ExecutorDeps {
  /** Path of the on-disk Etherpad install (the git working tree). */
  repoDir: string;
  /** Where pnpm-lock.yaml + sha info gets backed up. */
  backupDir: string;
  /** Injected child_process.spawn so tests can drive the pipeline deterministically. */
  spawnFn: SpawnFn;
  /** Returns the current HEAD SHA. Production callers wrap `git rev-parse HEAD`. */
  readSha: () => Promise<string>;
  /** Plain file copy. Production callers use fs.copyFile (with mkdir-p of parent). */
  copyFile: (src: string, dst: string) => Promise<void>;
  /** Persist the in-flight UpdateState. Production callers use saveState(stateFilePath()). */
  saveState: (s: UpdateState) => Promise<void>;
  /** State as it was when Apply was clicked — preserves Tier 1 fields (latest, email, etc.). */
  initialState: UpdateState;
  /** Tag to update to. */
  targetTag: string;
  /** Clock injection for deterministic timestamps in tests. */
  now: () => Date;
  /** process.exit injection so tests can assert exit code without actually exiting. */
  exit: (code: number) => void;
  /** Production callers may override this to run pnpm via Corepack. */
  pnpmCommand?: PnpmCommand;
}

export type ExecutorResult =
  | {outcome: 'pending-verification'}
  | {outcome: 'failed-install'; reason: string}
  | {outcome: 'failed-build'; reason: string}
  | {outcome: 'failed-checkout'; reason: string};

const runStep = (
  spawnFn: SpawnFn,
  repoDir: string,
  logPath: string,
  cmd: string,
  args: string[],
  tag = `${cmd} ${args.join(' ')}`,
): Promise<{code: number | null; stderr: string}> => new Promise((resolve) => {
  let stderr = '';
  let settled = false;
  const settle = (v: {code: number | null; stderr: string}) => {
    if (settled) return;
    settled = true;
    resolve(v);
  };
  const child = spawnFn(cmd, args, {cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.on('data', (chunk: Buffer) => {
    const txt = chunk.toString().trimEnd();
    logger.info(`[${tag}] ${txt}`);
    appendLine(logPath, `[${new Date().toISOString()}] ${tag} | ${txt}`);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const txt = chunk.toString();
    stderr += txt;
    const trimmed = txt.trimEnd();
    logger.warn(`[${tag}] ${trimmed}`);
    appendLine(logPath, `[${new Date().toISOString()}] ${tag} ERR | ${trimmed}`);
  });
  // Spawn failures (binary missing, permissions) emit 'error' and never close.
  // Without this listener the promise hangs forever and leaves state in-flight.
  // Treat as exit code 1 with the error message in stderr so the caller's
  // failure-detection branch fires normally.
  child.on('error', (err: Error) => {
    logger.error(`[${tag}] spawn error: ${err.message}`);
    appendLine(logPath, `[${new Date().toISOString()}] ${tag} SPAWN_ERR | ${err.message}`);
    settle({code: 1, stderr: stderr + err.message});
  });
  child.on('close', (code) => settle({code, stderr}));
});

/**
 * Run the update pipeline. Each transition writes state before/after so a hard
 * kill mid-step lands the next boot in a known state for RollbackHandler.
 *
 * On install/build/checkout failure the executor transitions to `rolling-back`,
 * persists, and returns. The route layer then runs RollbackHandler.performRollback.
 * The executor does NOT call `exit` on failure paths — the rollback path owns
 * that exit so we don't double-exit and lose log lines.
 *
 * On a thrown exception (e.g., copyFile EACCES, saveState ENOSPC) the executor
 * also transitions to rolling-back with `failed-checkout` so the route's post-
 * executor rollback path picks it up. The state must never get stuck at
 * `executing` — if it does, no further updates can start until an admin
 * acknowledges.
 */
export const executeUpdate = async (deps: ExecutorDeps): Promise<ExecutorResult> => {
  const logPath = path.join(deps.repoDir, 'var', 'log', 'update.log');
  let fromSha = '';

  // Wrap the whole body so any throw — readSha, saveState, copyFile, even an
  // unexpected synchronous error in a step — lands us at rolling-back rather
  // than leaving execution stuck at 'executing' forever.
  try {
    // Reject unsafe release-tag strings (option injection guard).
    // Tag is sourced from GitHub's tag_name and persisted into update-state.json;
    // a tag starting with '-' would otherwise be parsed by git as an option flag.
    const safeTag = assertValidTag(deps.targetTag);
    fromSha = await deps.readSha();

    let s: UpdateState = {
      ...deps.initialState,
      execution: {
        status: 'executing',
        targetTag: deps.targetTag,
        fromSha,
        startedAt: deps.now().toISOString(),
      },
      bootCount: 0,
    };
    await deps.saveState(s);

    // Snapshot lockfile (SHA already captured above; the rollback handler reads
    // execution.fromSha rather than a separate file so a successful rollback
    // doesn't depend on /var staying writable past this point).
    await deps.copyFile(
      path.join(deps.repoDir, 'pnpm-lock.yaml'),
      path.join(deps.backupDir, 'pnpm-lock.yaml'),
    );

    const fail = async (
      outcome: 'failed-install' | 'failed-build' | 'failed-checkout',
      reason: string,
    ): Promise<ExecutorResult> => {
      s = {
        ...s,
        execution: {
          status: 'rolling-back',
          reason,
          targetTag: deps.targetTag,
          fromSha,
          at: deps.now().toISOString(),
        },
      };
      await deps.saveState(s);
      logger.error(`update step failed (${outcome}): ${reason}`);
      appendLine(logPath, `[${deps.now().toISOString()}] FAIL ${outcome}: ${reason}`);
      return {outcome, reason};
    };

    let r = await runStep(deps.spawnFn, deps.repoDir, logPath, 'git', ['fetch', '--tags', 'origin']);
    if (r.code !== 0) return fail('failed-checkout', `git fetch exit ${r.code}: ${r.stderr.trim()}`);

    // Use the refs/tags/<tag> form so even an unforeseen edge-case in the tag
    // string can't be parsed as a git option. assertValidTag above already
    // rules out leading '-' / whitespace / shell metacharacters.
    r = await runStep(
      deps.spawnFn, deps.repoDir, logPath, 'git', ['checkout', refsTagsForm(safeTag)]);
    if (r.code !== 0) return fail('failed-checkout', `git checkout exit ${r.code}: ${r.stderr.trim()}`);

    const pnpmInstall = pnpmInvocation(deps.pnpmCommand, ['install', '--frozen-lockfile']);
    r = await runStep(
      deps.spawnFn, deps.repoDir, logPath,
      pnpmInstall.command, pnpmInstall.args, pnpmInstall.label);
    if (r.code !== 0) return fail('failed-install', `pnpm install exit ${r.code}: ${r.stderr.trim()}`);

    const pnpmBuild = pnpmInvocation(deps.pnpmCommand, ['run', 'build:ui']);
    r = await runStep(
      deps.spawnFn, deps.repoDir, logPath,
      pnpmBuild.command, pnpmBuild.args, pnpmBuild.label);
    if (r.code !== 0) return fail('failed-build', `pnpm run build:ui exit ${r.code}: ${r.stderr.trim()}`);

    // pending-verification: the next boot's RollbackHandler arms the health-check timer.
    s = {
      ...s,
      execution: {
        status: 'pending-verification',
        targetTag: deps.targetTag,
        fromSha,
        // Real deadline is computed at next boot using rollbackHealthCheckSeconds.
        // We persist a placeholder here purely so the field is present.
        deadlineAt: deps.now().toISOString(),
      },
      bootCount: 0,
    };
    await deps.saveState(s);
    logger.info(`update executed: ${fromSha} -> ${deps.targetTag}; exiting 75 for supervisor restart`);
    void appendLine(logPath, `[${deps.now().toISOString()}] OK pending-verification ${fromSha} -> ${deps.targetTag}; exiting 75`);
    deps.exit(75);
    return {outcome: 'pending-verification'};
  } catch (err) {
    // Unexpected throw — fs ENOSPC, EACCES on the backup dir, network blip
    // surfaced through readSha, etc. Persist rolling-back so the route's
    // post-executor rollback path runs and the state never wedges at 'executing'.
    const reason = `executor exception: ${(err as Error).message}`;
    logger.error(reason);
    void appendLine(logPath, `[${deps.now().toISOString()}] EXECUTOR_THROW ${reason}`);
    try {
      await deps.saveState({
        ...deps.initialState,
        execution: {
          status: 'rolling-back',
          reason,
          targetTag: deps.targetTag,
          fromSha,
          at: deps.now().toISOString(),
        },
        bootCount: 0,
      });
    } catch (saveErr) {
      // Even saveState threw. Best-effort log, rethrow original — the route's
      // catch will surface it. State on disk is whatever last successfully wrote.
      logger.error(`could not persist rolling-back: ${(saveErr as Error).message}`);
    }
    return {outcome: 'failed-checkout', reason};
  }
};
