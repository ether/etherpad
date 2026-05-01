'use strict';

/*
 * Compact a pad's revision history to reclaim database space.
 *
 * Usage:
 *   node bin/compactPad.js <padID>           # collapse all history
 *   node bin/compactPad.js <padID> --keep N  # keep only the last N revisions
 *
 * Wraps the existing Cleanup helper (src/node/utils/Cleanup.ts) via the
 * compactPad HTTP API so admins can trigger it from the CLI without
 * routing through the admin settings UI. Destructive — export the pad as
 * `.etherpad` first for backup.
 *
 * Issue #6194: long-lived pads with heavy edit history accumulate hundreds
 * of megabytes in the DB; this tool is the per-pad brick for reclaiming
 * that space without rotating to a new pad ID.
 */
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import axios from 'axios';

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.
process.on('unhandledRejection', (err) => { throw err; });

const settings = require('ep_etherpad-lite/tests/container/loadSettings').loadSettings();

axios.defaults.baseURL =
    `${settings.ssl ? 'https' : 'http'}://${settings.ip}:${settings.port}`;

const usage = () => {
  console.error('Usage:');
  console.error('  node bin/compactPad.js <padID>');
  console.error('  node bin/compactPad.js <padID> --keep <N>');
  process.exit(2);
};

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 3) usage();
const padId = args[0];

let keepRevisions: number | null = null;
if (args.length === 3) {
  if (args[1] !== '--keep') usage();
  keepRevisions = Number(args[2]);
  if (!Number.isInteger(keepRevisions) || keepRevisions < 0) {
    console.error(`--keep expects a non-negative integer; got ${args[2]}`);
    process.exit(2);
  }
}

// get the API Key
const filePath = path.join(__dirname, '../APIKEY.txt');
const apikey = fs.readFileSync(filePath, {encoding: 'utf-8'}).trim();

(async () => {
  const apiInfo = await axios.get('/api/');
  const apiVersion: string | undefined = apiInfo.data.currentVersion;
  if (!apiVersion) throw new Error('No version set in API');

  // Pre-flight: show current revision count so operators can eyeball impact.
  const countUri = `/api/${apiVersion}/getRevisionsCount?apikey=${apikey}&padID=${padId}`;
  const countRes = await axios.get(countUri);
  if (countRes.data.code !== 0) {
    console.error(`getRevisionsCount failed: ${JSON.stringify(countRes.data)}`);
    process.exit(1);
  }
  const before: number = countRes.data.data.revisions;
  const strategy = keepRevisions == null ? 'collapse all' : `keep last ${keepRevisions}`;
  console.log(`Pad ${padId}: ${before + 1} revision(s). Strategy: ${strategy}.`);

  const params = new URLSearchParams({apikey, padID: padId});
  if (keepRevisions != null) params.set('keepRevisions', String(keepRevisions));
  const result = await axios.post(`/api/${apiVersion}/compactPad?${params.toString()}`);
  if (result.data.code !== 0) {
    console.error(`compactPad failed: ${JSON.stringify(result.data)}`);
    process.exit(1);
  }

  // Post-flight: the pad is now compacted. Re-read the rev count so the
  // operator sees concrete savings.
  const afterRes = await axios.get(countUri);
  const after: number | undefined = afterRes.data?.data?.revisions;
  if (after != null) {
    console.log(`Done. Pad ${padId}: ${after + 1} revision(s) remaining ` +
                `(was ${before + 1}).`);
  } else {
    console.log('Done.');
  }
})();
