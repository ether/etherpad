'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import authorManager from '../../../node/db/AuthorManager.js';
import {strict as assert} from "assert";
import common from '../common.js';
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
    const {authorID} = await AuthorManager.createAuthor(); // Should block until db.set() finishes.
    assert(await AuthorManager.doesAuthorExist(authorID));
  });
});
