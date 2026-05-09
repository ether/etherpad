'use strict';

/*
 * Compact every pad on the instance that has not been edited recently.
 *
 * Usage:
 *   node bin/compactStalePads.js --older-than 90              # collapse history on pads not edited in 90 days
 *   node bin/compactStalePads.js --older-than 90 --keep 50    # keep last 50 revisions
 *   node bin/compactStalePads.js --older-than 90 --dry-run    # list, don't write
 *
 * Composes `listAllPads` → `getLastEdited` → `compactPad`. Same shape as
 * `bin/compactAllPads` (per-pad error tolerance, dry-run, tally), but
 * filters by edit-recency before touching anything. Targeting which pads
 * to compact is deliberately a CLI concern and not a `compactPad` API
 * param — staleness changes from one run to the next, the compaction
 * primitive does not.
 *
 * Destructive — `getEtherpad`-export anything you can't afford to lose
 * before running.
 *
 * Issue #7642: long-lived instances accumulate cold pads whose history
 * nobody is navigating any more. Hot pads should be left alone; this
 * tool is the brick for reclaiming space on the cold tail.
 */
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';

export type CompactStaleOpts = {
  olderThanDays: number;
  keepRevisions: number | null;
  dryRun: boolean;
};

// Minimal interface mirroring the API endpoints the script needs. Tests
// substitute their own implementation that goes through supertest+JWT
// instead of fetch+APIKEY, so the loop logic is exercised against a real
// running server without dragging in apikey-file or fetch setup.
export type CompactStaleApi = {
  listAllPads(): Promise<string[]>;
  getLastEdited(padId: string): Promise<number>;
  getRevisionsCount(padId: string): Promise<number>;
  compactPad(padId: string, keepRevisions: number | null): Promise<void>;
};

export type CompactStaleReport = {
  total: number;
  stale: number;
  ok: number;
  failed: number;
  skippedFresh: number;
  totalRevsBefore: number;
  totalRevsAfter: number;
};

export type CompactStaleLogger = {
  info(msg: string): void;
  error(msg: string): void;
};

const defaultLogger: CompactStaleLogger = {
  info: (m) => console.log(m),
  error: (m) => console.error(m),
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Pure-ish core: compose listAllPads → getLastEdited → compactPad with
// the same per-pad error tolerance + dry-run + tally as compactAllPads.
// `now` is injected so tests can pin the wall clock.
export const runCompactStale = async (
  api: CompactStaleApi, opts: CompactStaleOpts,
  logger: CompactStaleLogger = defaultLogger,
  now: () => number = Date.now,
): Promise<CompactStaleReport> => {
  const cutoff = now() - opts.olderThanDays * DAY_MS;

  let padIds: string[];
  try {
    padIds = await api.listAllPads();
  } catch (e: any) {
    logger.error(`listAllPads failed: ${e.message ?? e}`);
    return {
      total: 0, stale: 0, ok: 0, failed: 1, skippedFresh: 0,
      totalRevsBefore: 0, totalRevsAfter: 0,
    };
  }

  if (padIds.length === 0) {
    logger.info('No pads on this instance.');
    return {
      total: 0, stale: 0, ok: 0, failed: 0, skippedFresh: 0,
      totalRevsBefore: 0, totalRevsAfter: 0,
    };
  }

  const strategy = opts.keepRevisions == null
    ? 'collapse all history'
    : `keep last ${opts.keepRevisions} revisions`;
  logger.info(
      `Found ${padIds.length} pad(s). Filter: not edited in ` +
      `${opts.olderThanDays} day(s). Strategy: ${strategy}` +
      `${opts.dryRun ? ' (dry run — no writes)' : ''}.`);

  const report: CompactStaleReport = {
    total: padIds.length, stale: 0, ok: 0, failed: 0, skippedFresh: 0,
    totalRevsBefore: 0, totalRevsAfter: 0,
  };

  // First pass: figure out which pads are actually stale. A getLastEdited
  // failure on a pad is counted as a failure (we can't decide), but does
  // not stop the run.
  const stalePads: string[] = [];
  for (const padId of padIds) {
    let lastEdited: number;
    try {
      lastEdited = await api.getLastEdited(padId);
    } catch (e: any) {
      logger.error(`${padId}: getLastEdited failed: ${e.message ?? e}`);
      report.failed++;
      continue;
    }
    if (lastEdited > cutoff) {
      report.skippedFresh++;
      continue;
    }
    stalePads.push(padId);
  }
  report.stale = stalePads.length;

  if (stalePads.length === 0) {
    logger.info(
        `No stale pads (${report.skippedFresh} fresh, ${report.failed} unreadable).`);
    return report;
  }

  logger.info(
      `${stalePads.length} stale pad(s) to process ` +
      `(${report.skippedFresh} fresh skipped).`);

  for (let i = 0; i < stalePads.length; i++) {
    const padId = stalePads[i];
    const idx = `[${i + 1}/${stalePads.length}]`;

    let before: number;
    try {
      before = await api.getRevisionsCount(padId);
    } catch (e: any) {
      logger.error(`${idx} ${padId}: getRevisionsCount failed: ${e.message ?? e}`);
      report.failed++;
      continue;
    }

    if (opts.dryRun) {
      logger.info(`${idx} ${padId}: ${before + 1} revision(s) — would compact`);
      report.totalRevsBefore += before + 1;
      continue;
    }

    try {
      await api.compactPad(padId, opts.keepRevisions);
    } catch (e: any) {
      logger.error(`${idx} ${padId}: compactPad failed: ${e.message ?? e}`);
      report.failed++;
      continue;
    }

    let after: number | undefined;
    try { after = await api.getRevisionsCount(padId); }
    catch { /* main op already succeeded; post-count is informational */ }

    if (after != null) {
      logger.info(`${idx} ${padId}: ${before + 1} → ${after + 1} revision(s)`);
      report.totalRevsBefore += before + 1;
      report.totalRevsAfter += after + 1;
    } else {
      logger.info(`${idx} ${padId}: compacted (post-count unavailable)`);
    }
    report.ok++;
  }

  if (opts.dryRun) {
    logger.info('');
    logger.info(
        `Dry run complete. ${stalePads.length} stale pad(s), ` +
        `${report.totalRevsBefore} total revision(s) — re-run ` +
        'without --dry-run to compact.');
  } else {
    logger.info('');
    logger.info(
        `Done. ${report.ok} pad(s) compacted, ${report.failed} failed, ` +
        `${report.skippedFresh} fresh skipped. ` +
        `Revisions: ${report.totalRevsBefore} → ${report.totalRevsAfter} ` +
        `(reclaimed ${report.totalRevsBefore - report.totalRevsAfter}).`);
  }

  return report;
};

export const parseArgs = (argv: string[]): CompactStaleOpts | null => {
  const opts: CompactStaleOpts = {
    olderThanDays: NaN, keepRevisions: null, dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--older-than') {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        console.error(`--older-than expects a non-negative integer; got ${v}`);
        return null;
      }
      opts.olderThanDays = n;
    } else if (a === '--keep') {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        console.error(`--keep expects a non-negative integer; got ${v}`);
        return null;
      }
      opts.keepRevisions = n;
    } else {
      return null;
    }
  }
  if (!Number.isFinite(opts.olderThanDays)) {
    console.error('--older-than is required');
    return null;
  }
  return opts;
};

const usage = () => {
  console.error('Usage:');
  console.error('  node bin/compactStalePads.js --older-than <days>');
  console.error('  node bin/compactStalePads.js --older-than <days> --keep <N>');
  console.error('  node bin/compactStalePads.js --older-than <days> --dry-run');
  process.exit(2);
};

const isMain = require.main === module;
if (isMain) {
  process.on('unhandledRejection', (err) => { throw err; });

  const settings = require('ep_etherpad-lite/tests/container/loadSettings').loadSettings();
  const baseURL = `${settings.ssl ? 'https' : 'http'}://${settings.ip}:${settings.port}`;

  const apiGet = async (p: string): Promise<any> => {
    const r = await fetch(baseURL + p);
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.json();
  };
  const apiPost = async (p: string): Promise<any> => {
    const r = await fetch(baseURL + p, {method: 'POST'});
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.json();
  };

  const opts = parseArgs(process.argv.slice(2));
  if (!opts) usage();

  const apikey = fs.readFileSync(
      path.join(__dirname, '../APIKEY.txt'), {encoding: 'utf-8'}).trim();

  // Bind the abstract API to fetch + APIKEY auth for the CLI shell.
  const cliApi: CompactStaleApi = {
    async listAllPads() {
      const apiInfo = await apiGet('/api/');
      const apiVersion: string | undefined = apiInfo.currentVersion;
      if (!apiVersion) throw new Error('No version set in API');
      (cliApi as any)._apiVersion = apiVersion;
      const r = await apiGet(`/api/${apiVersion}/listAllPads?apikey=${apikey}`);
      if (r.code !== 0) throw new Error(JSON.stringify(r));
      return r.data.padIDs ?? [];
    },
    async getLastEdited(padId: string) {
      const v = (cliApi as any)._apiVersion;
      const r = await apiGet(
          `/api/${v}/getLastEdited?apikey=${apikey}` +
          `&padID=${encodeURIComponent(padId)}`);
      if (r.code !== 0) throw new Error(JSON.stringify(r));
      return r.data.lastEdited;
    },
    async getRevisionsCount(padId: string) {
      const v = (cliApi as any)._apiVersion;
      const r = await apiGet(
          `/api/${v}/getRevisionsCount?apikey=${apikey}` +
          `&padID=${encodeURIComponent(padId)}`);
      if (r.code !== 0) throw new Error(JSON.stringify(r));
      return r.data.revisions;
    },
    async compactPad(padId: string, keepRevisions: number | null) {
      const v = (cliApi as any)._apiVersion;
      const params = new URLSearchParams({apikey, padID: padId});
      if (keepRevisions != null) params.set('keepRevisions', String(keepRevisions));
      const r = await apiPost(`/api/${v}/compactPad?${params.toString()}`);
      if (r.code !== 0) throw new Error(JSON.stringify(r));
    },
  };

  (async () => {
    const report = await runCompactStale(cliApi, opts!);
    if (report.failed > 0) process.exit(1);
  })();
}
