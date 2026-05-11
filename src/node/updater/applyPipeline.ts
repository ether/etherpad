import {UpdateState} from './types';
import {PreflightResult, PreflightReason} from './preflight';
import {ExecutorResult} from './UpdateExecutor';
import {Drainer, DrainBroadcastKey} from './SessionDrainer';

export type ApplyOutcome =
  | {outcome: 'pending-verification'}
  | {outcome: 'preflight-failed'; reason: PreflightReason}
  | {outcome: 'cancelled'}
  | {outcome: 'lock-held'}
  | {outcome: 'busy'; status: string}
  | {outcome: 'invalid-tag'}
  | {outcome: 'no-known-latest'}
  | {outcome: 'rolled-back'};

export interface ApplySettings {
  tier: string;
  drainSeconds: number;
  diskSpaceMinMB: number;
  requireSignature: boolean;
  trustedKeysPath: string | null;
  adminEmail: string | null;
}

export interface ApplyPipelineDeps {
  loadState: () => Promise<UpdateState>;
  saveState: (s: UpdateState) => Promise<void>;
  acquireLock: () => Promise<boolean>;
  releaseLock: () => Promise<void>;
  isValidTag: (tag: string) => boolean;
  runPreflight: (targetTag: string) => Promise<PreflightResult>;
  createDrainer: (opts: {
    drainSeconds: number;
    broadcast: (k: DrainBroadcastKey, v: Record<string, unknown>) => void;
  }) => Drainer;
  executeUpdate: (args: {targetTag: string; initialState: UpdateState}) => Promise<ExecutorResult>;
  /** Run the rollback path. Production callers run `performRollback(state, getRollbackDeps())`, which exits the process on completion. */
  performRollback: (state: UpdateState) => Promise<void>;
  appendLog: (line: string) => void;
  broadcast?: (k: DrainBroadcastKey, v: Record<string, unknown>) => void;
  /** Optional. HTTP handler uses this to send 202 Accepted once the drain starts so the UI can begin polling. */
  onAccepted?: (info: {drainEndsAt: string}) => void;
  now: () => Date;
  installMethod: string;
  settings: ApplySettings;
}

const ALLOWED_ENTRY: ReadonlySet<string> = new Set([
  'idle', 'verified', 'preflight-failed', 'rolled-back', 'scheduled',
]);

/**
 * Shared apply pipeline used by both the `/admin/update/apply` HTTP handler
 * and the Tier 3 scheduler. Steps mirror updateActions.ts at the time of
 * extraction:
 *   1. validate state shape (latest known, valid tag, allowed entry status)
 *   2. acquire lock
 *   3. transition execution → 'preflight', run preflight; on fail → save
 *      preflight-failed + lastResult and return
 *   4. re-check post-preflight state (cancel detection)
 *   5. set up drainer, transition execution → 'draining', notify `onAccepted`
 *   6. await drain; cancelled → return
 *   7. executor; on failure path performRollback runs (and exits the process)
 *   8. release lock unless rollback owns the exit
 */
export const applyUpdate = async (
  {targetTag, deps}: {targetTag: string; deps: ApplyPipelineDeps},
): Promise<ApplyOutcome> => {
  const state = await deps.loadState();
  if (!state.latest) return {outcome: 'no-known-latest'};
  if (!deps.isValidTag(state.latest.tag) || state.latest.tag !== targetTag) {
    return {outcome: 'invalid-tag'};
  }
  if (!ALLOWED_ENTRY.has(state.execution.status)) {
    return {outcome: 'busy', status: state.execution.status};
  }
  if (!await deps.acquireLock()) return {outcome: 'lock-held'};

  let releaseLock = true;
  try {
    const startedAt = deps.now().toISOString();
    const preState: UpdateState = {
      ...state,
      execution: {status: 'preflight', targetTag, startedAt},
    };
    await deps.saveState(preState);
    deps.appendLog(`[${startedAt}] PREFLIGHT target=${targetTag}`);

    const pf = await deps.runPreflight(targetTag);
    if (!pf.ok) {
      const at = deps.now().toISOString();
      await deps.saveState({
        ...preState,
        execution: {status: 'preflight-failed', targetTag, reason: pf.reason, at},
        lastResult: {targetTag, fromSha: '', outcome: 'preflight-failed', reason: pf.reason, at},
      });
      deps.appendLog(`[${at}] PREFLIGHT_FAILED ${pf.reason}`);
      return {outcome: 'preflight-failed', reason: pf.reason};
    }

    // Re-load state after preflight: the cancel endpoint can flip execution
    // back to 'idle' while preflight ran. Bail before mutating the filesystem.
    const afterPreflight = await deps.loadState();
    if (afterPreflight.execution.status !== 'preflight'
        || (afterPreflight.execution as {targetTag?: string}).targetTag !== targetTag) {
      deps.appendLog(
        `[${deps.now().toISOString()}] APPLY aborted post-preflight ` +
        `(status=${afterPreflight.execution.status})`);
      return {outcome: 'cancelled'};
    }

    const drainSeconds = deps.settings.drainSeconds;
    const drainer = deps.createDrainer({
      drainSeconds,
      broadcast: deps.broadcast ?? (() => {}),
    });
    const drainEndsAt = new Date(deps.now().getTime() + drainSeconds * 1000).toISOString();
    await deps.saveState({
      ...preState,
      execution: {status: 'draining', targetTag, drainEndsAt, startedAt: deps.now().toISOString()},
    });
    deps.appendLog(`[${deps.now().toISOString()}] DRAIN start drainSeconds=${drainSeconds}`);
    deps.onAccepted?.({drainEndsAt});

    const drainResult = await drainer.start();
    if (drainResult.outcome === 'cancelled') {
      deps.appendLog(`[${deps.now().toISOString()}] DRAIN cancelled by admin`);
      return {outcome: 'cancelled'};
    }

    const fresh = await deps.loadState();
    const r = await deps.executeUpdate({targetTag, initialState: fresh});
    if (r.outcome !== 'pending-verification') {
      const after = await deps.loadState();
      if (after.execution.status === 'rolling-back') {
        // performRollback exits the process via exit(75) on both success and
        // terminal failure. The next-boot acquireLock reaps the stale PID.
        releaseLock = false;
        await deps.performRollback(after);
        return {outcome: 'rolled-back'};
      }
    }
    return {outcome: 'pending-verification'};
  } finally {
    if (releaseLock) {
      try { await deps.releaseLock(); } catch { /* swallow — best-effort */ }
    }
  }
};
