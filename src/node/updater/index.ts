import path from 'node:path';
import log4js from 'log4js';
import settings, {getEpVersion} from '../utils/Settings';
import {detectInstallMethod} from './InstallMethodDetector';
import {checkLatestRelease, realFetcher} from './VersionChecker';
import {loadState, saveState} from './state';
import {isMajorBehind, isVulnerable} from './versionCompare';
import {evaluatePolicy} from './UpdatePolicy';
import {decideEmails} from './Notifier';
import {InstallMethod, UpdateState} from './types';

const logger = log4js.getLogger('updater');

let detectedMethod: Exclude<InstallMethod, 'auto'> = 'managed';
let timer: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;
let checkInFlight = false;
let inMemoryState: UpdateState | null = null;

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
  const state = await getCurrentState();
  try {
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

    await saveState(stateFilePath(), state);
  } catch (err) {
    logger.warn(`Updater check failed: ${(err as Error).message}`);
  } finally {
    checkInFlight = false;
  }
};

const startPolling = (): void => {
  const intervalMs = Math.max(1, settings.updates.checkIntervalHours) * 60 * 60 * 1000;
  if (timer) clearInterval(timer);
  if (initialTimer) clearTimeout(initialTimer);
  timer = setInterval(() => { void performCheck(); }, intervalMs);
  // Run an immediate first check, but don't block boot. Track the handle so shutdown()
  // can cancel it before it fires.
  initialTimer = setTimeout(() => { initialTimer = null; void performCheck(); }, 5000);
};

/** Hook entry point — called by ep.json on createServer. */
export const expressCreateServer = async (): Promise<void> => {
  detectedMethod = await detectInstallMethod({
    override: settings.updates.installMethod,
    rootDir: settings.root,
  });
  logger.info(`updater: install method = ${detectedMethod}, tier = ${settings.updates.tier}`);
  if (settings.updates.tier !== 'off') startPolling();
};

/** Shutdown hook. */
export const shutdown = async (): Promise<void> => {
  if (timer) { clearInterval(timer); timer = null; }
  if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
};

/** Exposed for tests / route handlers. */
export const _internal = {
  performCheck,
  stateFilePath,
};
