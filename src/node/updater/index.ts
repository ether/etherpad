import path from 'node:path';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import log4js from 'log4js';
import settings, {getEpVersion} from '../utils/Settings';
import {detectInstallMethod} from './InstallMethodDetector';
import {checkLatestRelease, realFetcher} from './VersionChecker';
import {loadState, saveState} from './state';
import {isMajorBehind, isVulnerable} from './versionCompare';
import {evaluatePolicy} from './UpdatePolicy';
import {decideEmails} from './Notifier';
import {checkPendingVerification, CheckResult, RollbackDeps, performRollback} from './RollbackHandler';
import {executeUpdate, SpawnFn} from './UpdateExecutor';
import {createSchedulerRunner, decideSchedule, decideTriggerApply, SchedulerRunner} from './Scheduler';
import {applyUpdate, ApplyPipelineDeps} from './applyPipeline';
import {acquireLock, releaseLock} from './lock';
import {runPreflight} from './preflight';
import {verifyReleaseTag} from './trustedKeys';
import {createDrainer} from './SessionDrainer';
import {appendLine} from './updateLog';
import {isValidTag} from './refSafety';
import {InstallMethod, UpdateState} from './types';

const logger = log4js.getLogger('updater');

let detectedMethod: Exclude<InstallMethod, 'auto'> = 'managed';
let timer: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;
let checkInFlight = false;
let inMemoryState: UpdateState | null = null;
let pendingVerification: CheckResult | null = null;
let scheduler: SchedulerRunner | null = null;

export const stateFilePath = () => path.join(settings.root, 'var', 'update-state.json');

/** Returns the current state from memory; loads on first call. */
export const getCurrentState = async (): Promise<UpdateState> => {
  if (inMemoryState) return inMemoryState;
  inMemoryState = await loadState(stateFilePath());
  return inMemoryState;
};

export const getDetectedInstallMethod = () => detectedMethod;

const sendEmailViaSmtp = async (to: string, subject: string, body: string): Promise<void> => {
  // Etherpad core has no built-in SMTP. PR 1 ships the dedupe machinery without an actual sender;
  // subsequent PRs can wire nodemailer or rely on a notification plugin.
  logger.info(`(would send email) to=${to} subject="${subject}"`);
  void body;
};

const performCheck = async (): Promise<void> => {
  if (settings.updates.tier === 'off') return;
  // Coalesce overlapping ticks. performCheck mutates shared in-memory state and writes
  // it to disk; concurrent runs would race on saveState() and could double-send emails.
  if (checkInFlight) return;
  checkInFlight = true;
  try {
    // getCurrentState() can throw on a non-ENOENT fs error from loadState();
    // it must run inside the try/finally so checkInFlight is always cleared,
    // otherwise a one-time permission error permanently disables polling.
    const state = await getCurrentState();
    const result = await checkLatestRelease({
      fetcher: realFetcher,
      prevEtag: state.lastEtag,
      repo: settings.updates.githubRepo,
    });
    const now = new Date();
    state.lastCheckAt = now.toISOString();

    if (result.kind === 'updated') {
      state.latest = result.release;
      state.lastEtag = result.etag;
      // Union new directives with existing — same announcedBy is a no-op.
      const existingTags = new Set(state.vulnerableBelow.map((v) => v.announcedBy));
      for (const v of result.vulnerableBelow) {
        if (!existingTags.has(v.announcedBy)) state.vulnerableBelow.push(v);
      }
    } else if (result.kind === 'skipped-prerelease') {
      // Preserve ETag so we don't re-fetch an unchanged prerelease body next tick.
      state.lastEtag = result.etag;
    } else if (result.kind === 'notmodified') {
      // 304 — no state change.
    } else if (result.kind === 'ratelimited') {
      logger.warn('GitHub rate-limited; will retry at next interval');
    } else if (result.kind === 'error') {
      logger.warn(`GitHub fetch error status=${result.status}`);
    }

    // Notifier pass: only when we have a known latest, an admin email, and the policy allows notify.
    if (state.latest && settings.adminEmail) {
      const current = getEpVersion();
      const policy = evaluatePolicy({
        installMethod: detectedMethod,
        tier: settings.updates.tier,
        current,
        latest: state.latest.version,
      });
      if (policy.canNotify) {
        const decision = decideEmails({
          adminEmail: settings.adminEmail,
          current,
          latest: state.latest.version,
          latestTag: state.latest.tag,
          isVulnerable: isVulnerable(current, state.vulnerableBelow),
          isSevere: isMajorBehind(current, state.latest.version),
          state: state.email,
          now,
        });
        for (const email of decision.toSend) {
          await sendEmailViaSmtp(settings.adminEmail, email.subject, email.body);
        }
        state.email = decision.newState;
      }
    }

    // Tier 3 scheduler pass: decide whether to schedule, reschedule, or cancel.
    if (state.latest && scheduler) {
      const current = getEpVersion();
      const policy = evaluatePolicy({
        installMethod: detectedMethod,
        tier: settings.updates.tier,
        current,
        latest: state.latest.version,
        executionStatus: state.execution.status,
      });
      const decision = decideSchedule({
        state, now, policy,
        latest: state.latest, current,
        preApplyGraceMinutes: Number(settings.updates.preApplyGraceMinutes) || 0,
        adminEmail: settings.adminEmail,
      });
      if (decision.action === 'schedule') {
        state.execution = decision.newExecution;
        state.email = decision.newEmailState;
        for (const e of decision.emails) {
          // adminEmail is guaranteed non-null by decideSchedule when emails.length>0,
          // but the type doesn't carry that — re-check to keep TS happy.
          if (settings.adminEmail) {
            await sendEmailViaSmtp(settings.adminEmail, e.subject, e.body);
          }
        }
        scheduler.arm({
          targetTag: decision.newExecution.targetTag,
          scheduledFor: decision.newExecution.scheduledFor,
        });
      } else if (decision.action === 'cancel-schedule') {
        state.execution = {status: 'idle'};
        scheduler.cancel();
        logger.info(`updater: cancelled pending schedule (${decision.reason})`);
      }
    }

    await saveState(stateFilePath(), state);
  } catch (err) {
    logger.warn(`Updater check failed: ${(err as Error).message}`);
  } finally {
    checkInFlight = false;
  }
};

const startPolling = (): void => {
  // Coerce in case settings.json carries a non-number (Math.max(1, NaN) === NaN,
  // which becomes a tight setInterval loop). Clamp to a sane window: at least 1h
  // (don't hammer GitHub) and at most a week (don't silently stop checking).
  const rawHours = Number(settings.updates.checkIntervalHours);
  const safeHours = Number.isFinite(rawHours) ? Math.min(168, Math.max(1, rawHours)) : 6;
  if (safeHours !== rawHours) {
    logger.warn(`updates.checkIntervalHours invalid (${settings.updates.checkIntervalHours}); using ${safeHours}h`);
  }
  const intervalMs = safeHours * 60 * 60 * 1000;
  if (timer) clearInterval(timer);
  if (initialTimer) clearTimeout(initialTimer);
  timer = setInterval(() => { void performCheck(); }, intervalMs);
  // Run an immediate first check, but don't block boot. Track the handle so shutdown()
  // can cancel it before it fires.
  initialTimer = setTimeout(() => { initialTimer = null; void performCheck(); }, 5000);
};

/** Build the dependency bundle RollbackHandler / UpdateExecutor expect. */
export const getRollbackDeps = (): RollbackDeps => ({
  repoDir: settings.root,
  backupDir: path.join(settings.root, 'var', 'update-backup'),
  spawnFn: spawn as unknown as SpawnFn,
  copyFile: async (src: string, dst: string) => {
    await fs.mkdir(path.dirname(dst), {recursive: true});
    await fs.copyFile(src, dst);
  },
  saveState: (s: UpdateState) => saveState(stateFilePath(), s),
  exit: (code: number) => process.exit(code),
  now: () => new Date(),
  rollbackHealthCheckSeconds: Number(settings.updates.rollbackHealthCheckSeconds) || 60,
});

const lockPath = (): string => path.join(settings.root, 'var', 'update.lock');
const logPath = (): string => path.join(settings.root, 'var', 'log', 'update.log');

/**
 * Build the ApplyPipelineDeps the scheduler uses when its timer fires.
 * Production wiring only — no HTTP response semantics, no Socket.IO broadcast
 * (the drain announcements live in the route handler today; wiring them
 * from the scheduler path is a follow-up — for now scheduler-triggered
 * updates skip the broadcast and rely on the admin UI countdown).
 */
const buildSchedulerApplyDeps = (): ApplyPipelineDeps => ({
  loadState: () => loadState(stateFilePath()),
  saveState: (s: UpdateState) => saveState(stateFilePath(), s),
  acquireLock: () => acquireLock(lockPath()),
  releaseLock: async () => {
    try { await releaseLock(lockPath()); }
    catch (err) { logger.warn(`releaseLock: ${(err as Error).message}`); }
  },
  isValidTag,
  runPreflight: async (tag) => runPreflight(
    {
      targetTag: tag,
      diskSpaceMinMB: Number(settings.updates.diskSpaceMinMB) || 500,
      requireSignature: settings.updates.requireSignature,
      trustedKeysPath: settings.updates.trustedKeysPath,
    },
    {
      installMethod: detectedMethod,
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
          return Number.POSITIVE_INFINITY;
        }
      },
      pnpmOnPath: () => new Promise<boolean>((resolve) => {
        const c = spawn('pnpm', ['--version'], {stdio: 'ignore'});
        c.on('close', (code) => resolve(code === 0));
        c.on('error', () => resolve(false));
      }),
      lockHeld: async () => false, // pipeline already holds the lock here
      remoteHasTag: (tagName: string) => new Promise<boolean>((resolve) => {
        const c = spawn('git', ['ls-remote', '--tags', 'origin', tagName],
                        {cwd: settings.root, stdio: ['ignore', 'pipe', 'ignore']});
        let out = '';
        c.stdout.on('data', (b) => { out += b.toString(); });
        c.on('close', () => resolve(out.trim().length > 0));
        c.on('error', () => resolve(false));
      }),
      verifyTag: () => verifyReleaseTag({
        tag,
        repoDir: settings.root,
        requireSignature: settings.updates.requireSignature,
        trustedKeysPath: settings.updates.trustedKeysPath,
      }),
    },
  ),
  createDrainer: (opts) => createDrainer(opts),
  executeUpdate: async ({targetTag, initialState}) => executeUpdate({
    repoDir: settings.root,
    backupDir: path.join(settings.root, 'var', 'update-backup'),
    spawnFn: spawn as unknown as SpawnFn,
    readSha: () => new Promise<string>((resolve, reject) => {
      const c = spawn('git', ['rev-parse', 'HEAD'], {cwd: settings.root, stdio: ['ignore', 'pipe', 'ignore']});
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
    targetTag,
    now: () => new Date(),
    exit: (code: number) => process.exit(code),
  }),
  performRollback: (s) => performRollback(s, getRollbackDeps()),
  appendLog: (line: string) => appendLine(logPath(), line),
  now: () => new Date(),
  installMethod: detectedMethod,
  settings: {
    tier: settings.updates.tier,
    drainSeconds: Number(settings.updates.drainSeconds) || 60,
    diskSpaceMinMB: Number(settings.updates.diskSpaceMinMB) || 500,
    requireSignature: settings.updates.requireSignature,
    trustedKeysPath: settings.updates.trustedKeysPath,
    adminEmail: settings.adminEmail,
  },
});

/** Allow the cancel handler to drop the pending scheduler timer. */
export const cancelScheduler = (): void => { scheduler?.cancel(); };

/**
 * Timer-fire callback. Re-reads persisted state and re-evaluates policy
 * *before* invoking applyUpdate so a last-moment cancel, a manual Apply now
 * (which flips status away from `scheduled`), or a tier/policy flip during
 * the grace window cannot lead to an unintended auto-apply.
 *
 * SchedulerRunnerDeps.triggerApply documents this contract; doing the check
 * here keeps the runner itself pure (no state I/O). Qodo #2.
 */
const schedulerTriggerApply = async (targetTag: string): Promise<void> => {
  try {
    const state = await loadState(stateFilePath());
    const policy = state.latest
      ? evaluatePolicy({
          installMethod: detectedMethod,
          tier: settings.updates.tier,
          current: getEpVersion(),
          latest: state.latest.version,
          executionStatus: state.execution.status,
        })
      : {canNotify: false, canManual: false, canAuto: false, canAutonomous: false, reason: 'no-latest'};
    const decision = decideTriggerApply({state, targetTag, policy});
    if (decision.action === 'abort') {
      logger.info(`scheduler fired for ${targetTag} but aborting (${decision.reason})`);
      return;
    }
    if (decision.action === 'clear-schedule') {
      logger.info(
        `scheduler fired for ${targetTag} but policy denies auto ` +
        `(${decision.reason}); clearing schedule`);
      await saveState(stateFilePath(), {...state, execution: {status: 'idle'}});
      return;
    }
    const result = await applyUpdate({targetTag, deps: buildSchedulerApplyDeps()});
    logger.info(`scheduler apply finished: ${result.outcome}`);
  } catch (err) {
    logger.warn(`scheduler apply failed: ${(err as Error).message}`);
  }
};

/** Hook entry point — called by ep.json on createServer. */
export const expressCreateServer = async (): Promise<void> => {
  detectedMethod = await detectInstallMethod({
    override: settings.updates.installMethod,
    rootDir: settings.root,
  });
  logger.info(`updater: install method = ${detectedMethod}, tier = ${settings.updates.tier}`);

  // Tier 2: if the previous boot left the state in pending-verification, arm
  // the health-check timer (or force rollback when bootCount has climbed past
  // the crash-loop threshold). This must run BEFORE polling starts so the
  // rollback can fire even if the version checker is misconfigured.
  const state = await getCurrentState();
  pendingVerification = checkPendingVerification(state, getRollbackDeps());

  // Tier 3: instantiate the scheduler unless updates are entirely disabled.
  // The runner is purely in-memory — the persisted state file is the source
  // of truth for "is something scheduled." On `tier: "off"` we explicitly
  // clear any previously-persisted scheduled state to idle so a stale
  // schedule from a prior boot can't auto-fire after the operator opted
  // out (Qodo #1).
  if (settings.updates.tier === 'off') {
    if (state.execution.status === 'scheduled') {
      logger.info(
        `updater: discarding pending Tier 3 schedule for ${state.execution.targetTag} ` +
        `because updates.tier="off"`);
      state.execution = {status: 'idle'};
      await saveState(stateFilePath(), state);
    }
  } else {
    scheduler = createSchedulerRunner({
      now: () => new Date(),
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: clearTimeout,
      triggerApply: schedulerTriggerApply,
    });
    if (state.execution.status === 'scheduled') {
      logger.info(`updater: rehydrating Tier 3 schedule for ${state.execution.targetTag} at ${state.execution.scheduledFor}`);
      scheduler.arm({
        targetTag: state.execution.targetTag,
        scheduledFor: state.execution.scheduledFor,
      });
    }
  }

  if (settings.updates.tier !== 'off') startPolling();
};

/**
 * Called by the Etherpad runtime once the express stack is fully wired and
 * /health responds — that's the implicit health signal the
 * pending-verification timer is waiting for.
 */
export const markBootHealthy = (): void => {
  if (pendingVerification) {
    pendingVerification.markVerified();
    pendingVerification = null;
  }
};

/** Shutdown hook. */
export const shutdown = async (): Promise<void> => {
  if (timer) { clearInterval(timer); timer = null; }
  if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
  if (scheduler) { scheduler.cancel(); scheduler = null; }
};

/** Exposed for tests / route handlers. */
export const _internal = {
  performCheck,
  stateFilePath,
};
