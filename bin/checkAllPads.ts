'use strict';
/*
 * This is a debug tool. It checks all revisions for data corruption
 */
import process from "node:process";

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.
process.on('unhandledRejection', (err) => { throw err; });

if (process.argv.length !== 2) throw new Error('Use: node bin/checkAllPads.js');

(async () => {
  const db = require('ep_etherpad-lite/node/db/DB');
  await db.init();
  const padManager = require('ep_etherpad-lite/node/db/PadManager');
  await Promise.all((await padManager.listAllPads()).padIDs.map(async (padId: string) => {
    const pad = await padManager.getPad(padId);
    try {
      await pad.check();
    } catch (err:any) {
      console.error(`Error in pad ${padId}: ${err.stack || err}`);
      return;
    }
    console.log(`Pad ${padId}: OK`);
  }));
  console.log('Finished.');
  process.exit(0)
})();
