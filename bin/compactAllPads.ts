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

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.
process.on('unhandledRejection', (err) => { throw err; });

const settings = require('ep_etherpad-lite/tests/container/loadSettings').loadSettings();

axios.defaults.baseURL = `http://${settings.ip}:${settings.port}`;

const usage = () => {
  console.error('Usage:');
  console.error('  node bin/compactAllPads.js');
  console.error('  node bin/compactAllPads.js --keep <N>');
  console.error('  node bin/compactAllPads.js --dry-run');
  process.exit(2);
};

const args = process.argv.slice(2);
let keepRevisions: number | null = null;
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dry-run') {
    dryRun = true;
  } else if (a === '--keep') {
    const v = args[++i];
    keepRevisions = Number(v);
    if (!Number.isInteger(keepRevisions) || keepRevisions < 0) {
      console.error(`--keep expects a non-negative integer; got ${v}`);
      process.exit(2);
    }
  } else {
    usage();
  }
}

const filePath = path.join(__dirname, '../APIKEY.txt');
const apikey = fs.readFileSync(filePath, {encoding: 'utf-8'}).trim();

(async () => {
  const apiInfo = await axios.get('/api/');
  const apiVersion: string | undefined = apiInfo.data.currentVersion;
  if (!apiVersion) throw new Error('No version set in API');

  const listRes = await axios.get(`/api/${apiVersion}/listAllPads?apikey=${apikey}`);
  if (listRes.data.code !== 0) {
    console.error(`listAllPads failed: ${JSON.stringify(listRes.data)}`);
    process.exit(1);
  }
  const padIds: string[] = listRes.data.data.padIDs ?? [];
  if (padIds.length === 0) {
    console.log('No pads on this instance.');
    return;
  }

  const strategy = keepRevisions == null
    ? 'collapse all history'
    : `keep last ${keepRevisions} revisions`;
  console.log(`Found ${padIds.length} pad(s). Strategy: ${strategy}` +
              `${dryRun ? ' (dry run — no writes)' : ''}.`);

  let okCount = 0;
  let failCount = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  for (let i = 0; i < padIds.length; i++) {
    const padId = padIds[i];
    const idx = `[${i + 1}/${padIds.length}]`;

    let before: number;
    try {
      const r = await axios.get(
          `/api/${apiVersion}/getRevisionsCount?apikey=${apikey}` +
          `&padID=${encodeURIComponent(padId)}`);
      if (r.data.code !== 0) throw new Error(JSON.stringify(r.data));
      before = r.data.data.revisions;
    } catch (e: any) {
      console.error(`${idx} ${padId}: getRevisionsCount failed: ${e.message ?? e}`);
      failCount++;
      continue;
    }

    if (dryRun) {
      console.log(`${idx} ${padId}: ${before + 1} revision(s) — would compact`);
      totalBefore += before + 1;
      continue;
    }

    try {
      const params = new URLSearchParams({apikey, padID: padId});
      if (keepRevisions != null) params.set('keepRevisions', String(keepRevisions));
      const r = await axios.post(`/api/${apiVersion}/compactPad?${params.toString()}`);
      if (r.data.code !== 0) throw new Error(JSON.stringify(r.data));
    } catch (e: any) {
      console.error(`${idx} ${padId}: compactPad failed: ${e.message ?? e}`);
      failCount++;
      continue;
    }

    let after: number | undefined;
    try {
      const r = await axios.get(
          `/api/${apiVersion}/getRevisionsCount?apikey=${apikey}` +
          `&padID=${encodeURIComponent(padId)}`);
      if (r.data.code === 0) after = r.data.data.revisions;
    } catch { /* swallow — main op already succeeded */ }

    if (after != null) {
      console.log(`${idx} ${padId}: ${before + 1} → ${after + 1} revision(s)`);
      totalBefore += before + 1;
      totalAfter += after + 1;
    } else {
      console.log(`${idx} ${padId}: compacted (post-count unavailable)`);
    }
    okCount++;
  }

  console.log('');
  if (dryRun) {
    console.log(`Dry run complete. ${padIds.length} pad(s), ${totalBefore} ` +
                'total revision(s) — re-run without --dry-run to compact.');
  } else {
    console.log(`Done. ${okCount} pad(s) compacted, ${failCount} failed. ` +
                `Revisions: ${totalBefore} → ${totalAfter} ` +
                `(reclaimed ${totalBefore - totalAfter}).`);
  }
  if (failCount > 0) process.exit(1);
})();
