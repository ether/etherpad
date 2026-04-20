'use strict';

/*
 * Compact a pad's revision history in place.
 *
 * Usage: node bin/compactPad.js <padID>
 *
 * Collapses every existing revision into a single base revision that
 * reproduces the current pad content. Text, attributes, and chat history
 * are preserved; saved-revision bookmarks are cleared. Destructive —
 * export the pad as `.etherpad` first for a backup.
 *
 * Implements issue #6194 (admins need a way to reclaim DB space on
 * long-lived pads without rotating to a new pad ID).
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

if (process.argv.length !== 3) {
  console.error('Use: node bin/compactPad.js <padID>');
  process.exit(2);
}

const padId = process.argv[2];

// get the API Key
const filePath = path.join(__dirname, '../APIKEY.txt');
const apikey = fs.readFileSync(filePath, {encoding: 'utf-8'}).trim();

(async () => {
  const apiInfo = await axios.get('/api/');
  const apiVersion: string | undefined = apiInfo.data.currentVersion;
  if (!apiVersion) throw new Error('No version set in API');

  // Pre-flight: report current revision count so the operator sees the
  // savings. getRevisionsCount is older than compactPad so every
  // supporting server has it.
  const countUri = `/api/${apiVersion}/getRevisionsCount?apikey=${apikey}&padID=${padId}`;
  const countRes = await axios.get(countUri);
  if (countRes.data.code !== 0) {
    console.error(`Failed to read revision count: ${JSON.stringify(countRes.data)}`);
    process.exit(1);
  }
  const before: number = countRes.data.data.revisions;
  console.log(`Pad ${padId}: ${before + 1} revision(s) on disk.`);

  const uri = `/api/${apiVersion}/compactPad?apikey=${apikey}&padID=${padId}`;
  const result = await axios.post(uri);
  if (result.data.code !== 0) {
    console.error(`compactPad failed: ${JSON.stringify(result.data)}`);
    process.exit(1);
  }
  const removed: number = result.data.data.removed;
  console.log(`Compacted pad ${padId}: removed ${removed} revision(s). ` +
              'Pad now has a single base revision reproducing the current content.');
})();
