'use strict';

import process from "node:process";

/*
 * This is a repair tool. It extracts all datas of a pad, removes and inserts them again.
 */

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.
process.on('unhandledRejection', (err) => { throw err; });

console.warn('WARNING: This script must not be used while etherpad is running!');

if (process.argv.length !== 3) throw new Error('Use: node ./src/bin/repairPad.js $PADID');

// get the padID
const padId = process.argv[2];

let valueCount = 0;

(async () => {
  // initialize database
  require('ep_etherpad-lite/node/utils/Settings');
  const db = require('ep_etherpad-lite/node/db/DB');
  await db.init();

  // get the pad
  const padManager = require('ep_etherpad-lite/node/db/PadManager');
  const pad = await padManager.getPad(padId);

  // accumulate the required keys
  const neededDBValues = [`pad:${padId}`];

  // add all authors
  neededDBValues.push(...pad.getAllAuthors().map((author: string) => `globalAuthor:${author}`));

  // add all revisions
  for (let rev = 0; rev <= pad.head; ++rev) {
    neededDBValues.push(`pad:${padId}:revs:${rev}`);
  }

  // add all chat values
  for (let chat = 0; chat <= pad.chatHead; ++chat) {
    neededDBValues.push(`pad:${padId}:chat:${chat}`);
  }
  // now fetch and reinsert every key
  console.log('Fetch and reinsert every key');
  for (const key of neededDBValues) {
    if (valueCount % 100 === 0) console.log(valueCount + "/" + neededDBValues.length);
    const value = await db.get(key);
    // if it isn't a globalAuthor value which we want to ignore..
    // console.log(`Key: ${key}, value: ${JSON.stringify(value)}`);
    await db.remove(key);
    await db.set(key, value);
    valueCount++;
  }

  console.info(`Finished: Replaced ${valueCount} values in the database`);
  process.exit(0)
})();
