'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import * as authorManager from '../../../node/db/AuthorManager.js';
import {strict as assert} from "assert";
import * as common from '../common.js';
import db from '../../../node/db/DB.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AuthorManager = authorManager;

describe(__filename, function () {
  let setBackup: Function;

  before(async function () {
    await common.init();
    setBackup = db.set;

    db.set = async (...args:any) => {
      // delay db.set
      await new Promise<void>((resolve) => { setTimeout(() => resolve(), 500); });
      return await setBackup.call(db, ...args);
    };
  });

  after(async function () {
    db.set = setBackup;
  });

  it('regression test for missing await in createAuthor (#5000)', async function () {
    const t0 = Date.now();
    const {authorID} = await AuthorManager.createAuthor(); // Should block until db.set() finishes.
    const elapsedMs = Date.now() - t0;
    assert(
        elapsedMs >= 450,
        `createAuthor returned too early (${elapsedMs}ms), expected it to wait for delayed db.set()`,
    );

    let exists = false;
    for (let i = 0; i < 20; i++) {
      exists = await AuthorManager.doesAuthorExist(authorID);
      if (exists) break;
      await new Promise<void>((resolve) => { setTimeout(() => resolve(), 50); });
    }
    assert(exists);
  });
});
