'use strict';

/*
 * Pad retention: delete pads nobody has edited for `padRetention.deleteAfterDays`.
 *
 * Pads are checked by a periodic sweep and again when someone opens one, so an
 * overdue pad never loads with its old content, however long ago the last sweep
 * ran. Deletion goes through pad.remove(), the same path as the deletePad API,
 * so connected users are kicked and the padRemove hook fires for plugins.
 *
 * Off by default, and log-only (dryRun) until the operator turns that off too.
 */

import log4js from 'log4js';
import settings from './Settings';

const db = require('../db/DB');
const padManager = require('../db/PadManager');

const logger = log4js.getLogger('padRetention');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 60 * 1000;

export type RetentionConfig = {
  dryRun: boolean,
  deleteAfterMs: number,
  deleteAfterDays: number,
  warnBeforeMs: number,
  sweepIntervalMs: number,
  excludeGroupPads: boolean,
  excludePattern: RegExp | null,
};

export type CheckResult =
  {action: 'skip', reason: string} |
  {action: 'keep', expiresAt: number} |
  {action: 'expire', lastEdited: number};

export type ClientRetentionInfo =
  null |
  {state: 'expiring', msRemaining: number} |
  {state: 'expired', deleteAfterDays: number};

const isPositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Validates settings.padRetention. Returns null when the feature is off, and
 * throws with a readable message when it is on but misconfigured.
 */
export const parseConfig = (raw: any = settings.padRetention): RetentionConfig | null => {
  if (raw == null || raw.enabled !== true) return null;
  if (!isPositive(raw.deleteAfterDays)) {
    throw new Error(`padRetention.deleteAfterDays must be a positive number, got ${JSON.stringify(raw.deleteAfterDays)}`);
  }
  const warnBeforeDays = raw.warnBeforeDays ?? 0;
  if (typeof warnBeforeDays !== 'number' || !Number.isFinite(warnBeforeDays) || warnBeforeDays < 0) {
    throw new Error(`padRetention.warnBeforeDays must be 0 or more, got ${JSON.stringify(raw.warnBeforeDays)}`);
  }
  const sweepIntervalHours = raw.sweepIntervalHours ?? 1;
  if (!isPositive(sweepIntervalHours)) {
    throw new Error(`padRetention.sweepIntervalHours must be a positive number, got ${JSON.stringify(raw.sweepIntervalHours)}`);
  }
  let excludePattern: RegExp | null = null;
  if (raw.excludePattern != null && raw.excludePattern !== '') {
    if (typeof raw.excludePattern !== 'string') {
      throw new Error('padRetention.excludePattern must be a string or null');
    }
    try {
      excludePattern = new RegExp(raw.excludePattern);
    } catch (err: any) {
      throw new Error(`padRetention.excludePattern is not a valid regex: ${err.message}`);
    }
  }
  return {
    dryRun: raw.dryRun !== false,
    deleteAfterMs: raw.deleteAfterDays * DAY_MS,
    deleteAfterDays: raw.deleteAfterDays,
    warnBeforeMs: warnBeforeDays * DAY_MS,
    sweepIntervalMs: sweepIntervalHours * HOUR_MS,
    excludeGroupPads: raw.excludeGroupPads !== false,
    excludePattern,
  };
};

// The config in force, set by start(). checkOnOpen() uses it so an invalid
// config, which start() refused, can't delete anything on the open path either.
let active: RetentionConfig | null = null;

/**
 * Works out whether a pad is due for deletion. Reads the database directly
 * rather than through padManager.getPad() so a sweep doesn't pull every pad
 * into the pad cache.
 */
export const checkPad = async (
  padId: string, cfg: RetentionConfig, now: number = Date.now(),
): Promise<CheckResult> => {
  if (cfg.excludeGroupPads && padId.includes('$')) return {action: 'skip', reason: 'group pad'};
  if (cfg.excludePattern != null && cfg.excludePattern.test(padId)) {
    return {action: 'skip', reason: 'excludePattern'};
  }
  const padRecord = await db.get(`pad:${padId}`);
  if (padRecord == null || padRecord.atext == null) return {action: 'skip', reason: 'missing'};
  const head = padRecord.head;
  if (typeof head !== 'number' || head < 0) return {action: 'skip', reason: 'no head revision'};
  const lastEdited = await db.getSub(`pad:${padId}:revs:${head}`, ['meta', 'timestamp']);
  if (typeof lastEdited !== 'number' || !Number.isFinite(lastEdited)) {
    return {action: 'skip', reason: 'no timestamp on head revision'};
  }
  const expiresAt = lastEdited + cfg.deleteAfterMs;
  // A last edit in the future means clock skew; keep the pad.
  if (lastEdited > now || expiresAt > now) return {action: 'keep', expiresAt};
  return {action: 'expire', lastEdited};
};

const inFlight = new Map<string, Promise<boolean>>();

/**
 * Deletes a pad if it is still expired. Re-checks right before deleting so an
 * edit that landed since the caller's check saves the pad. Returns true if the
 * pad was deleted (or, in dry run, would have been).
 */
export const expirePad = async (padId: string, cfg: RetentionConfig): Promise<boolean> => {
  const running = inFlight.get(padId);
  if (running != null) return await running;
  const p = (async () => {
    const result = await checkPad(padId, cfg);
    if (result.action !== 'expire') return false;
    const lastEdited = new Date(result.lastEdited).toISOString();
    if (cfg.dryRun) {
      logger.info(`dry run: would delete pad ${padId} (last edited ${lastEdited})`);
      return true;
    }
    const pad = await padManager.getPad(padId);
    await pad.remove();
    logger.info(`deleted pad ${padId}: last edited ${lastEdited}, ` +
        `older than deleteAfterDays=${cfg.deleteAfterDays}`);
    return true;
  })();
  inFlight.set(padId, p);
  try {
    return await p;
  } finally {
    inFlight.delete(padId);
  }
};

export type SweepReport = {
  checked: number, deleted: number, skipped: number, errors: number, durationMs: number,
};

/**
 * Checks every pad once. One broken pad is logged and skipped, not fatal.
 * `cancelled` is polled between pads so shutdown doesn't wait for a full sweep.
 */
export const sweep = async (
  cfg: RetentionConfig, cancelled: () => boolean = () => false,
): Promise<SweepReport> => {
  const started = Date.now();
  const report: SweepReport = {checked: 0, deleted: 0, skipped: 0, errors: 0, durationMs: 0};
  const {padIDs} = await padManager.listAllPads();
  for (const padId of padIDs) {
    if (cancelled()) break;
    report.checked++;
    try {
      if (await expirePad(padId, cfg)) report.deleted++;
      else report.skipped++;
    } catch (err: any) {
      report.errors++;
      logger.warn(`could not check pad ${padId}: ${err.stack || err}`);
    }
    // Let pad traffic through between pads on large instances.
    await new Promise((resolve) => setImmediate(resolve));
  }
  report.durationMs = Date.now() - started;
  logger.info(`sweep${cfg.dryRun ? ' (dry run)' : ''}: checked ${report.checked}, ` +
      `${cfg.dryRun ? 'would delete' : 'deleted'} ${report.deleted}, ` +
      `kept or skipped ${report.skipped}, errors ${report.errors}, ` +
      `took ${report.durationMs}ms`);
  return report;
};

/**
 * Called when a client opens a pad, before the pad is loaded. Deletes the pad
 * if it is overdue and tells the client what happened, or how long is left
 * when the pad is inside the warning window.
 */
export const checkOnOpen = async (padId: string, now: number = Date.now()): Promise<ClientRetentionInfo> => {
  const cfg = active;
  // Dry run tells clients nothing: nothing is going to be deleted.
  if (cfg == null || cfg.dryRun) return null;
  try {
    const result = await checkPad(padId, cfg, now);
    if (result.action === 'expire') {
      if (await expirePad(padId, cfg)) return {state: 'expired', deleteAfterDays: cfg.deleteAfterDays};
      return null;
    }
    if (result.action === 'keep' && cfg.warnBeforeMs > 0) {
      const msRemaining = result.expiresAt - now;
      if (msRemaining <= cfg.warnBeforeMs) return {state: 'expiring', msRemaining};
    }
  } catch (err: any) {
    // Never block a pad from opening over retention.
    logger.warn(`could not check pad ${padId} on open: ${err.stack || err}`);
  }
  return null;
};

let timer: NodeJS.Timeout | null = null;
let sweepRunning: Promise<unknown> | null = null;

const schedule = (cfg: RetentionConfig, delay: number) => {
  timer = setTimeout(async () => {
    sweepRunning = sweep(cfg, () => active !== cfg).catch((err) => logger.error(`sweep failed: ${err.stack || err}`));
    await sweepRunning;
    sweepRunning = null;
    if (active === cfg) schedule(cfg, cfg.sweepIntervalMs);
  }, delay);
  timer.unref();
};

/** Reads settings and (re)starts the sweeper. Safe to call more than once. */
export const start = () => {
  stop();
  let cfg: RetentionConfig | null;
  try {
    cfg = parseConfig();
  } catch (err: any) {
    logger.error(`${err.message}. Pad retention is OFF until this is fixed.`);
    return;
  }
  if (cfg == null) return;
  active = cfg;
  logger.info(`pad retention ${cfg.dryRun ? 'in DRY RUN (nothing is deleted)' : 'ON'}: ` +
      `pads unedited for ${cfg.deleteAfterDays} day(s) ` +
      `${cfg.dryRun ? 'would be' : 'are'} deleted`);
  schedule(cfg, FIRST_SWEEP_DELAY_MS);
};

export const stop = () => {
  active = null;
  if (timer != null) clearTimeout(timer);
  timer = null;
};

// Hooks, registered in ep.json.
export const expressCreateServer = () => { start(); };
export const shutdown = async () => {
  stop();
  // stop() cancels the sweep at the next pad; wait for the pad in progress so
  // nothing is deleted while the database is closing.
  if (sweepRunning != null) await sweepRunning;
};
