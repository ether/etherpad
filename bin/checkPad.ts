'use strict';
/*
 * This is a debug tool. It checks all revisions for data corruption
 */
import process from "node:process";

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.
process.on('unhandledRejection', (err) => { throw err; });

if (process.argv.length !== 3) throw new Error('Use: node bin/checkPad.js $PADID');
// @ts-ignore
const padId = process.argv[2];

const performCheck = async () => {
  const db = require('ep_etherpad-lite/node/db/DB');
  await db.init();
  console.log("Checking if " + padId + " exists")
  const padManager = require('ep_etherpad-lite/node/db/PadManager');
  if (!await padManager.doesPadExists(padId)) throw new Error('Pad does not exist');
  const pad = await padManager.getPad(padId);
  await pad.check();
  console.log('Finished checking pad.');
  process.exit(0)
}

performCheck()
  .then(e=>console.log("Finished"))
  .catch(e=>console.log("Finished with errors"))
