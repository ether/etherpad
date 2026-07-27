'use strict';

import process from 'node:process';
import {Database, DatabaseType} from "ueberdb2";
import log4js from 'log4js';
import settings from 'ep_etherpad-lite/node/utils/Settings';

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.
process.on('unhandledRejection', (err) => { throw err; });

(async () => {
  // This script requires that you have modified your settings.json file
  // to work with a real database.  Please make a backup of your dirty.db
  // file before using this script, just to be safe.

  // It might be necessary to run the script using more memory:
  // `node --max-old-space-size=4096 src/bin/migrateDirtyDBtoRealDB.js`


  const dbWrapperSettings = {
    cache: '0', // The cache slows things down when you're mostly writing.
    writeInterval: 0, // Write directly to the database, don't buffer
  };
  const db = new Database( // eslint-disable-line new-cap
      settings.dbType as DatabaseType,
      settings.dbSettings,
      dbWrapperSettings,
      log4js.getLogger('ueberDB'));
  await db.init();

  console.log('Waiting for dirtyDB to parse its file.');
  const dirty = new Database('dirty', `${__dirname}/../var/dirty.db`);
    await dirty.init();
  const keys = await dirty.findKeys('*', '')

  console.log(`Found ${keys.length} records, processing now.`);
  let numWritten = 0;
  for (const key of keys) {
    const value = await dirty.get(key);
    await db.set(key, value);
    if (++numWritten % 100 === 0) console.log(`Wrote record ${numWritten} of ${keys.length}`);
  }
  console.log(`Wrote all ${numWritten} records`);

  await db.close();
  await dirty.close();
  console.log('Finished.');
  process.exit(0)
})();
