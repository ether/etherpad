'use strict';

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.
import util from "node:util";
import fs from 'node:fs';
import log4js from 'log4js';
import readline from 'readline';
import {Database, DatabaseType} from "ueberdb2";
import process from "node:process";

import settings from 'ep_etherpad-lite/node/utils/Settings';
process.on('unhandledRejection', (err) => { throw err; });
const startTime = Date.now();

const log = (str:string) => {
  console.log(`${(Date.now() - startTime) / 1000}\t${str}`);
};

const unescape = (val: string) => {
  // value is a string
  if (val.substring(0, 1) === "'") {
    val = val.substring(0, val.length - 1).substring(1);

    return val.replace(/\\[0nrbtZ\\'"]/g, (s) => {
      switch (s) {
        case '\\0': return '\0';
        case '\\n': return '\n';
        case '\\r': return '\r';
        case '\\b': return '\b';
        case '\\t': return '\t';
        case '\\Z': return '\x1a';
        default: return s.substring(1);
      }
    });
  }

  // value is a boolean or NULL
  if (val === 'NULL') {
    return null;
  }
  if (val === 'true') {
    return true;
  }
  if (val === 'false') {
    return false;
  }

  // value is a number
  return val;
};

(async () => {

  const dbWrapperSettings = {
    cache: 0,
    writeInterval: 100,
    json: false, // data is already json encoded
  };
  const db = new Database( // eslint-disable-line new-cap
      settings.dbType as DatabaseType,
      settings.dbSettings,
      dbWrapperSettings,
      log4js.getLogger('ueberDB'));

  const sqlFile = process.argv[2];

  // stop if the settings file is not set
  if (!sqlFile) throw new Error('Use: node importSqlFile.js $SQLFILE');

  log('initializing db');
  const initDb = await util.promisify(db.init.bind(db));
  await initDb(null);
  log('done');

  log(`Opening ${sqlFile}...`);
  const stream = fs.createReadStream(sqlFile, {encoding: 'utf8'});

  log(`Reading ${sqlFile}...`);
  let keyNo = 0;
  for await (const l of readline.createInterface({input: stream, crlfDelay: Infinity})) {
    if (l.substring(0, 27) === 'REPLACE INTO store VALUES (') {
      const pos = l.indexOf("', '");
      const key = l.substring(28, pos - 28);
      let value = l.substring(pos + 3);
      value = value.substring(0, value.length - 2);
      console.log(`key: ${key} val: ${value}`);
      console.log(`unval: ${unescape(value)}`);
      // @ts-ignore
      db.set(key, unescape(value), null);
      keyNo++;
      if (keyNo % 1000 === 0) log(` ${keyNo}`);
    }
  }
  process.stdout.write('\n');
  process.stdout.write('done. waiting for db to finish transaction. ' +
                       'depended on dbms this may take some time..\n');

  const closeDB = util.promisify(db.close.bind(db));
  // @ts-ignore
  await closeDB(null);
  log(`finished, imported ${keyNo} keys.`);
  process.exit(0)
})();
