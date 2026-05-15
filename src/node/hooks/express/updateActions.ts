'use strict';

import path from 'node:path';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import log4js from 'log4js';
import {ArgsExpressType} from '../../types/ArgsExpressType';
import settings, {getEpVersion} from '../../utils/Settings';
import {getDetectedInstallMethod, stateFilePath, getRollbackDeps, notifyApplyFailure} from '../../updater';
import {evaluatePolicy} from '../../updater/UpdatePolicy';
import {loadState, saveState} from '../../updater/state';
import {acquireLock, releaseLock} from '../../updater/lock';
import {executeUpdate, SpawnFn} from '../../updater/UpdateExecutor';
import {createDrainer, DrainBroadcastKey, Drainer} from '../../updater/SessionDrainer';
import {runPreflight} from '../../updater/preflight';
import {verifyReleaseTag} from '../../updater/trustedKeys';
import {tailLines, appendLine} from '../../updater/updateLog';
import {performRollback} from '../../updater/RollbackHandler';
import {UpdateState} from '../../updater/types';
import {isValidTag} from '../../updater/refSafety';
import {applyUpdate} from '../../updater/applyPipeline';
import {cancelScheduler} from '../../updater';
import {getIo} from './socketio';

const logger = log4js.getLogger('updater');

const lockPath = (): string => path.join(settings.root, 'var', 'update.lock');
const logPath = (): string => path.join(settings.root, 'var', 'log', 'update.log');
const backupDir = (): string => path.join(settings.root, 'var', 'update-backup');

let drainer: Drainer | null = null;

const requireAdmin = (req: any, res: any): boolean => {
  const u = req.session?.user;
  if (!u) { res.status(401).send('Authentication required'); return false; }
  if (!u.is_admin) { res.status(403).send('Forbidden'); return false; }
  return true;
};

const wrapAsync =
  (fn: (req: any, res: any, next: Function) => Promise<unknown>) =>
    (req: any, res: any, next: Function) => Promise.resolve(fn(req, res, next)).catch((err) => next(err));

const broadcastShout = (key: DrainBroadcastKey, values: Record<string, unknown>): void => {
  try {
    const io = getIo();
    if (!io) return;
    // The pad-side renderer (src/static/js/pad.ts) already handles `messageKey`
    // by routing through html10n.get(); we add a `values` field that the
    // renderer interpolates into the localised string.
    const message = {
      type: 'COLLABROOM',
      data: {
        type: 'shoutMessage',
        payload: {
          message: {messageKey: key, values, sticky: false},
          timestamp: Date.now(),
        },
      },
    };
    io.sockets.emit('shout', message);
  } catch (err) {
    logger.warn(`broadcastShout: ${(err as Error).message}`);
  }
};

const buildPreflightDeps = (installMethod: ReturnType<typeof getDetectedInstallMethod>) => ({
  installMethod,
  workingTreeClean: () => new Promise<boolean>((resolve) => {
    const c = spawn('git', ['status', '--porcelain'], {cwd: settings.root});
    let out = '';
    c.stdout.on('data', (b) => { out += b.toString(); });
    c.on('close', () => resolve(out.trim().length === 0));
    c.on('error', () => resolve(false));
  }),
  freeDiskMB: async (): Promise<number> => {
    try {
      const s = await (fs as any).statfs?.(settings.root);
      if (!s) return Number.POSITIVE_INFINITY;
      return Math.floor((Number(s.bavail) * Number(s.bsize)) / (1024 * 1024));
    } catch {
      // statfs unsupported on this platform — treat as "no constraint" rather than block.
      return Number.POSITIVE_INFINITY;
    }
  },
  pnpmOnPath: () => new Promise<boolean>((resolve) => {
    const c = spawn('pnpm', ['--version'], {stdio: 'ignore'});
    c.on('close', (code) => resolve(code === 0));
    c.on('error', () => resolve(false));
  }),
  // We just acquired the lock in the apply endpoint, so don't double-check it here.
  lockHeld: async () => false,
  remoteHasTag: (tag: string) => new Promise<boolean>((resolve) => {
    const c = spawn('git', ['ls-remote', '--tags', 'origin', tag],
                    {cwd: settings.root, stdio: ['ignore', 'pipe', 'ignore']});
    let out = '';
    c.stdout.on('data', (b) => { out += b.toString(); });
    c.on('close', () => resolve(out.trim().length > 0));
    c.on('error', () => resolve(false));
  }),
  verifyTag: () => verifyReleaseTag({
    tag: '', // overridden below — we close over targetTag
    repoDir: settings.root,
    requireSignature: settings.updates.requireSignature,
    trustedKeysPath: settings.updates.trustedKeysPath,
  }),
  readTargetEnginesNode: (tag: string) => new Promise<string | null>((resolve) => {
    const c = spawn('git', ['show', `${tag}:package.json`],
                    {cwd: settings.root, stdio: ['ignore', 'pipe', 'ignore']});
    let out = '';
    c.stdout.on('data', (b) => { out += b.toString(); });
    c.on('close', () => {
      try {
        const pkg = JSON.parse(out);
        const range = pkg?.engines?.node;
        resolve(typeof range === 'string' && range.trim().length > 0 ? range : null);
      } catch { resolve(null); }
    });
    c.on('error', () => resolve(null));
  }),
});

/**
 * The set of update tiers at which the Tier 2 action endpoints serve.
 * `notify` only ships read-only routes (registered in updateStatus.ts);
 * `manual` and higher are the supersets that include manual-click. Disabled
 * paths (off / notify) match prior behaviour: requests 404, no new attack
 * surface vs PR 1.
 *
 * Read at request time (not hook-init time) so that operators flipping
 * `updates.tier` in settings.json + reloading take effect without a full
 * restart, and so that integration tests can drive the gate dynamically.
 */
const TIER2_TIERS: ReadonlySet<string> = new Set(['manual', 'auto', 'autonomous']);
const tierAllowsActions = (): boolean => TIER2_TIERS.has(settings.updates.tier);

export const expressCreateServer = (
  _hookName: string,
  {app}: ArgsExpressType,
  cb: Function,
): void => {
  // Always register the routes; gate at request time so a runtime tier change
  // takes effect on the next request rather than requiring a restart.
  // The early 404 below preserves Qodo #1's "disabled path matches prior
  // behaviour (no Tier 2 endpoints existed before this PR)" requirement.
  const tierGate = (req: any, res: any, next: Function) => {
    if (!tierAllowsActions()) return res.status(404).send('Not found');
    next();
  };
  app.use(['/admin/update/apply', '/admin/update/cancel', '/admin/update/acknowledge', '/admin/update/log'], tierGate);

  app.post('/admin/update/apply', wrapAsync(async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;

    // HTTP-specific pre-checks: produce structured 4xx error codes the UI
    // localises. The pipeline duplicates these as safety, but mapping cleanly
    // to status codes is easier when we know the failure kind up-front.
    const state = await loadState(stateFilePath());
    if (!state.latest) return res.status(409).json({error: 'no-known-latest'});
    if (!isValidTag(state.latest.tag)) {
      return res.status(409).json({error: 'invalid-tag-in-state'});
    }
    // Allowed entry statuses: idle / verified / preflight-failed / rolled-back / scheduled.
    // `scheduled` lets the admin "Apply now" during the Tier 3 grace window.
    const allowedEntry = ['idle', 'verified', 'preflight-failed', 'rolled-back', 'scheduled'];
    if (!allowedEntry.includes(state.execution.status)) {
      return res.status(409).json({error: `execution-busy:${state.execution.status}`});
    }
    const installMethod = getDetectedInstallMethod();
    const policy = evaluatePolicy({
      installMethod,
      tier: settings.updates.tier,
      current: getEpVersion(),
      latest: state.latest.version,
      executionStatus: state.execution.status,
    });
    if (!policy.canManual) {
      return res.status(409).json({error: 'policy-denied', reason: policy.reason});
    }

    // Admin clicked "Apply now" during the Tier 3 grace window. Drop the
    // pending scheduler timer so it doesn't later fire and attempt a second
    // apply (Qodo #3). The pipeline will overwrite execution → preflight
    // momentarily, but cancelling the timer is what guarantees we don't race.
    if (state.execution.status === 'scheduled') cancelScheduler();

    const targetTag = state.latest.tag;
    let responded = false;

    try {
      const result = await applyUpdate({
        targetTag,
        deps: {
          loadState: () => loadState(stateFilePath()),
          saveState: (s: UpdateState) => saveState(stateFilePath(), s),
          acquireLock: () => acquireLock(lockPath()),
          releaseLock: async () => {
            try { await releaseLock(lockPath()); }
            catch (err) { logger.warn(`releaseLock: ${(err as Error).message}`); }
          },
          isValidTag,
          runPreflight: async (tag) => {
            const baseDeps = buildPreflightDeps(installMethod);
            return runPreflight(
              {
                targetTag: tag,
                diskSpaceMinMB: Number(settings.updates.diskSpaceMinMB) || 500,
                requireSignature: settings.updates.requireSignature,
                trustedKeysPath: settings.updates.trustedKeysPath,
                currentNodeVersion: process.versions.node,
              },
              {
                ...baseDeps,
                verifyTag: () => verifyReleaseTag({
                  tag,
                  repoDir: settings.root,
                  requireSignature: settings.updates.requireSignature,
                  trustedKeysPath: settings.updates.trustedKeysPath,
                }),
              },
            );
          },
          createDrainer: (opts) => {
            drainer = createDrainer(opts);
            return drainer;
          },
          executeUpdate: async ({targetTag: tag, initialState}) => executeUpdate({
            repoDir: settings.root,
            backupDir: backupDir(),
            spawnFn: spawn as unknown as SpawnFn,
            readSha: () => new Promise<string>((resolve, reject) => {
              const c = spawn('git', ['rev-parse', 'HEAD'],
                              {cwd: settings.root, stdio: ['ignore', 'pipe', 'ignore']});
              let out = '';
              c.stdout.on('data', (b) => { out += b.toString(); });
              c.on('close', (code) => code === 0
                ? resolve(out.trim())
                : reject(new Error(`git rev-parse exit ${code}`)));
              c.on('error', reject);
            }),
            copyFile: async (src: string, dst: string) => {
              await fs.mkdir(path.dirname(dst), {recursive: true});
              await fs.copyFile(src, dst);
            },
            saveState: (s: UpdateState) => saveState(stateFilePath(), s),
            initialState,
            targetTag: tag,
            now: () => new Date(),
            exit: (code: number) => process.exit(code),
          }),
          performRollback: (s) => performRollback(s, getRollbackDeps()),
          appendLog: (line) => appendLine(logPath(), line),
          broadcast: (key, values) => broadcastShout(key, values),
          onAccepted: ({drainEndsAt}) => {
            if (!responded) {
              responded = true;
              res.status(202).json({accepted: true, drainEndsAt});
            }
          },
          now: () => new Date(),
          installMethod,
          settings: {
            tier: settings.updates.tier,
            drainSeconds: Number(settings.updates.drainSeconds) || 60,
            diskSpaceMinMB: Number(settings.updates.diskSpaceMinMB) || 500,
            requireSignature: settings.updates.requireSignature,
            trustedKeysPath: settings.updates.trustedKeysPath,
            adminEmail: settings.adminEmail,
          },
        },
      });
      drainer = null;

      // Fire the failure-notification email path for outcomes the admin needs
      // to know about even on manual apply (an admin might click Apply and
      // walk away; rolling back silently isn't enough). Errors here are
      // swallowed by notifyApplyFailure — they must not block the response.
      if (result.outcome === 'preflight-failed') {
        void notifyApplyFailure({
          outcome: 'preflight-failed', targetTag, reason: result.reason,
        });
      } else if (result.outcome === 'rolled-back') {
        void notifyApplyFailure({
          outcome: 'rolled-back', targetTag, reason: 'rolled-back',
        });
      }

      if (responded) return; // already 202'd in onAccepted; nothing more to send.

      switch (result.outcome) {
        case 'no-known-latest':
          return res.status(409).json({error: 'no-known-latest'});
        case 'invalid-tag':
          return res.status(409).json({error: 'invalid-tag-in-state'});
        case 'busy':
          return res.status(409).json({error: `execution-busy:${result.status}`});
        case 'lock-held':
          return res.status(409).json({error: 'lock-held'});
        case 'preflight-failed':
          return res.status(409).json({error: 'preflight-failed', reason: result.reason});
        case 'cancelled':
          return res.status(409).json({error: 'cancelled-during-preflight'});
        case 'pending-verification':
        case 'rolled-back':
        default:
          // Process should have exited via executor.exit(75) or performRollback.
          // If we reach here in a test stub, surface the outcome as a 200.
          return res.json({outcome: result.outcome});
      }
    } catch (err) {
      logger.error(`apply failed: ${(err as Error).stack || err}`);
      appendLine(logPath(), `[${new Date().toISOString()}] APPLY_ERROR ${(err as Error).message}`);
      if (!res.headersSent) res.status(500).json({error: 'internal'});
    }
  }));

  app.post('/admin/update/cancel', wrapAsync(async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    const state = await loadState(stateFilePath());
    // Cancel is allowed only during pre-execute states. Once executing begins
    // (filesystem mutated) we either complete or rollback — see spec section
    // "Error handling" / state machine. Tier 3's `scheduled` is also pre-execute.
    const cancellable: ReadonlySet<string> = new Set(['scheduled', 'preflight', 'draining']);
    if (!cancellable.has(state.execution.status)) {
      return res.status(409).json({error: 'not-cancellable', status: state.execution.status});
    }
    // Tier 3: drop the pending scheduler timer if we're cancelling a schedule.
    if (state.execution.status === 'scheduled') cancelScheduler();
    if (drainer) drainer.cancel();
    const at = new Date().toISOString();
    await saveState(stateFilePath(), {
      ...state,
      execution: {status: 'idle'},
      lastResult: {
        targetTag: (state.execution as {targetTag?: string}).targetTag ?? '',
        fromSha: '',
        outcome: 'cancelled',
        reason: 'admin-cancelled',
        at,
      },
    });
    // Intentionally do NOT release the lock here. The apply handler owns the
    // lock for its lifetime and releases it in its finally block; releasing
    // here would let a second apply slip in while the first is still mid-
    // preflight, racing for the same on-disk state.
    appendLine(logPath(), `[${at}] CANCEL by admin during status=${state.execution.status}`);
    res.json({cancelled: true});
  }));

  app.post('/admin/update/acknowledge', wrapAsync(async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    const state = await loadState(stateFilePath());
    const terminal: ReadonlySet<string> = new Set(['rollback-failed', 'preflight-failed', 'rolled-back']);
    if (!terminal.has(state.execution.status)) {
      return res.status(409).json({error: 'not-terminal', status: state.execution.status});
    }
    await saveState(stateFilePath(), {...state, execution: {status: 'idle'}, bootCount: 0});
    appendLine(logPath(), `[${new Date().toISOString()}] ACKNOWLEDGE ${state.execution.status} -> idle`);
    res.json({acknowledged: true});
  }));

  app.get('/admin/update/log', wrapAsync(async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    const lines = await tailLines(logPath(), 200);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(lines.join('\n'));
  }));

  cb();
};
