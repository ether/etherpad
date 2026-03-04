'use strict';

/*
 * This is a debug tool. It helps to extract all datas of a pad and move it from
 * a productive environment and to a develop environment to reproduce bugs
 * there. It outputs a dirtydb file
 */

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.
import util from "node:util";
import process from "node:process";
process.on('unhandledRejection', (err) => { throw err; });
if (process.argv.length !== 3) throw new Error('Use: node extractPadData.js $PADID');

// get the padID
const padId = process.argv[2];

(async () => {
  // initialize database
  require('ep_etherpad-lite/node/utils/Settings');
  const db = require('ep_etherpad-lite/node/db/DB');
  await db.init();

  // load extra modules
  const dirtyDB = require('dirty');
  const padManager = require('ep_etherpad-lite/node/db/PadManager');

  // initialize output database
  const dirty = dirtyDB(`${padId}.db`);

  // Promise set function
  const set = util.promisify(dirty.set.bind(dirty));

  // array in which required key values will be accumulated
  const neededDBValues = [`pad:${padId}`];

  // get the actual pad object
  const pad = await padManager.getPad(padId);

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

  for (const dbkey of neededDBValues) {
    let dbvalue = await db.get(dbkey);
    if (dbvalue && typeof dbvalue !== 'object') {
      dbvalue = JSON.parse(dbvalue);
    }
    await set(dbkey, dbvalue);
  }

  console.log('finished');
  process.exit(0)
})();
