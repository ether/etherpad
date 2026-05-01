'use strict';

/*
 * Compact every pad on the instance to reclaim database space.
 *
 * Usage:
 *   node bin/compactAllPads.js              # collapse all history on every pad
 *   node bin/compactAllPads.js --keep N     # keep last N revisions per pad
 *   node bin/compactAllPads.js --dry-run    # list pads + rev counts, no writes
 *
 * Composes the existing `listAllPads` and `compactPad` HTTP APIs — there is
 * deliberately no instance-wide HTTP endpoint, because doing this over a
 * single request would mean one giant response and a long-held connection.
 * Per-pad failures don't stop the run; they're logged and counted, and the
 * exit code reflects whether anything failed.
 *
 * Destructive — `getEtherpad`-export anything you can't afford to lose
 * before running.
 *
 * Issue #6194: per-instance bulk compaction. The per-pad `bin/compactPad`
 * is the right tool when you know which pad is fat; this is the right tool
 * when you want to reclaim space across the whole instance.
 */
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import axios from 'axios';

export type CompactAllOpts = {
  keepRevisions: number | null;
  dryRun: boolean;
};

// Minimal interface mirroring the API endpoints the script needs. Tests
// substitute their own implementation that goes through supertest+JWT
// instead of axios+APIKEY, so the loop logic is exercised against a real
// running server without dragging in apikey-file or axios setup.
export type CompactAllApi = {
  listAllPads(): Promise<string[]>;
  getRevisionsCount(padId: string): Promise<number>;
  compactPad(padId: string, keepRevisions: number | null): Promise<void>;
};

export type CompactAllReport = {
  total: number;
  ok: number;
  failed: number;
  totalRevsBefore: number;
  totalRevsAfter: number;
};

export type CompactAllLogger = {
  info(msg: string): void;
  error(msg: string): void;
};

const defaultLogger: CompactAllLogger = {
  info: (m) => console.log(m),
  error: (m) => console.error(m),
};

// Pure-ish core: composition + per-pad error tolerance + dry-run + tally.
// Returns a structured report so tests can assert on outcomes; the CLI
// shell maps it to an exit code.
export const runCompactAll = async (
  api: CompactAllApi, opts: CompactAllOpts,
  logger: CompactAllLogger = defaultLogger,
): Promise<CompactAllReport> => {
  let padIds: string[];
  try {
    padIds = await api.listAllPads();
  } catch (e: any) {
    logger.error(`listAllPads failed: ${e.message ?? e}`);
    return {total: 0, ok: 0, failed: 1, totalRevsBefore: 0, totalRevsAfter: 0};
  }

  if (padIds.length === 0) {
    logger.info('No pads on this instance.');
    return {total: 0, ok: 0, failed: 0, totalRevsBefore: 0, totalRevsAfter: 0};
  }

  const strategy = opts.keepRevisions == null
    ? 'collapse all history'
    : `keep last ${opts.keepRevisions} revisions`;
  logger.info(`Found ${padIds.length} pad(s). Strategy: ${strategy}` +
              `${opts.dryRun ? ' (dry run — no writes)' : ''}.`);

  const report: CompactAllReport = {
    total: padIds.length, ok: 0, failed: 0,
    totalRevsBefore: 0, totalRevsAfter: 0,
  };

  for (let i = 0; i < padIds.length; i++) {
    const padId = padIds[i];
    const idx = `[${i + 1}/${padIds.length}]`;

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
    logger.info(`Dry run complete. ${padIds.length} pad(s), ` +
                `${report.totalRevsBefore} total revision(s) — re-run ` +
                'without --dry-run to compact.');
  } else {
    logger.info('');
    logger.info(`Done. ${report.ok} pad(s) compacted, ${report.failed} failed. ` +
                `Revisions: ${report.totalRevsBefore} → ${report.totalRevsAfter} ` +
                `(reclaimed ${report.totalRevsBefore - report.totalRevsAfter}).`);
  }

  return report;
};

export const parseArgs = (argv: string[]): CompactAllOpts | null => {
  const opts: CompactAllOpts = {keepRevisions: null, dryRun: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      opts.dryRun = true;
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
  return opts;
};

// CLI entry point. Skipped when this file is imported (e.g. by tests),
// so the test harness can use `runCompactAll` directly without network.
const usage = () => {
  console.error('Usage:');
  console.error('  node bin/compactAllPads.js');
  console.error('  node bin/compactAllPads.js --keep <N>');
  console.error('  node bin/compactAllPads.js --dry-run');
  process.exit(2);
};

const isMain = require.main === module;
if (isMain) {
  process.on('unhandledRejection', (err) => { throw err; });

  const settings = require('ep_etherpad-lite/tests/container/loadSettings').loadSettings();
  axios.defaults.baseURL = `http://${settings.ip}:${settings.port}`;

  const opts = parseArgs(process.argv.slice(2));
  if (!opts) usage();

  const apikey = fs.readFileSync(
      path.join(__dirname, '../APIKEY.txt'), {encoding: 'utf-8'}).trim();

  // Bind the abstract API to axios + APIKEY auth for the CLI shell.
  const cliApi: CompactAllApi = {
    async listAllPads() {
      const apiInfo = await axios.get('/api/');
      const apiVersion: string | undefined = apiInfo.data.currentVersion;
      if (!apiVersion) throw new Error('No version set in API');
      // Stash on this for subsequent calls. Avoids a per-call /api/ ping.
      (cliApi as any)._apiVersion = apiVersion;
      const r = await axios.get(`/api/${apiVersion}/listAllPads?apikey=${apikey}`);
      if (r.data.code !== 0) throw new Error(JSON.stringify(r.data));
      return r.data.data.padIDs ?? [];
    },
    async getRevisionsCount(padId: string) {
      const v = (cliApi as any)._apiVersion;
      const r = await axios.get(
          `/api/${v}/getRevisionsCount?apikey=${apikey}` +
          `&padID=${encodeURIComponent(padId)}`);
      if (r.data.code !== 0) throw new Error(JSON.stringify(r.data));
      return r.data.data.revisions;
    },
    async compactPad(padId: string, keepRevisions: number | null) {
      const v = (cliApi as any)._apiVersion;
      const params = new URLSearchParams({apikey, padID: padId});
      if (keepRevisions != null) params.set('keepRevisions', String(keepRevisions));
      const r = await axios.post(`/api/${v}/compactPad?${params.toString()}`);
      if (r.data.code !== 0) throw new Error(JSON.stringify(r.data));
    },
  };

  (async () => {
    const report = await runCompactAll(cliApi, opts!);
    if (report.failed > 0) process.exit(1);
  })();
}
