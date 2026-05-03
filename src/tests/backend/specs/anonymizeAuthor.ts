'use strict';

import {strict as assert} from 'assert';

const common = require('../common');
const authorManager = require('../../../node/db/AuthorManager');
const DB = require('../../../node/db/DB');

describe(__filename, function () {
  before(async function () {
    this.timeout(60000);
    await common.init();
  });

  it('zeroes the display identity on globalAuthor:<id>', async function () {
    const mapper = `mapper-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const {authorID} = await authorManager.createAuthorIfNotExistsFor(mapper, 'Alice');
    assert.equal(await authorManager.getAuthorName(authorID), 'Alice');

    const res = await authorManager.anonymizeAuthor(authorID);
    assert.ok(res.removedExternalMappings >= 1,
        `removedExternalMappings=${res.removedExternalMappings}`);

    const record = await DB.db.get(`globalAuthor:${authorID}`);
    assert.equal(record.name, null);
    assert.equal(record.colorId, 0);
    assert.equal(record.erased, true);
    assert.ok(typeof record.erasedAt === 'string');
  });

  it('drops token2author and mapper2author mappings pointing at the author',
      async function () {
        const mapper = `mapper-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const {authorID} = await authorManager.createAuthorIfNotExistsFor(mapper, 'Bob');
        const token =
            `t.${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
        // Seed a token2author:<token> → authorID mapping directly so the test
        // does not depend on getAuthorId creating a fresh author.
        await DB.db.set(`token2author:${token}`, authorID);

        assert.equal(await DB.db.get(`token2author:${token}`), authorID);
        assert.equal(await DB.db.get(`mapper2author:${mapper}`), authorID);

        const res = await authorManager.anonymizeAuthor(authorID);
        assert.ok(res.removedTokenMappings >= 1,
            `removedTokenMappings=${res.removedTokenMappings}`);
        assert.ok(res.removedExternalMappings >= 1);
        assert.ok((await DB.db.get(`token2author:${token}`)) == null);
        assert.ok((await DB.db.get(`mapper2author:${mapper}`)) == null);
      });

  it('is idempotent — second call returns zero counters', async function () {
    const mapper = `mapper-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const {authorID} = await authorManager.createAuthorIfNotExistsFor(mapper, 'Carol');
    await authorManager.anonymizeAuthor(authorID);
    const second = await authorManager.anonymizeAuthor(authorID);
    assert.deepEqual(second, {
      affectedPads: 0,
      removedTokenMappings: 0,
      removedExternalMappings: 0,
      clearedChatMessages: 0,
    });
  });

  it('returns zero counters for an unknown authorID', async function () {
    const res = await authorManager.anonymizeAuthor('a.does-not-exist');
    assert.deepEqual(res, {
      affectedPads: 0,
      removedTokenMappings: 0,
      removedExternalMappings: 0,
      clearedChatMessages: 0,
    });
  });

  it('re-runs the sweep when a prior call errored before setting erased=true',
      async function () {
        const mapper = `mapper-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const {authorID} = await authorManager.createAuthorIfNotExistsFor(mapper, 'Dan');

        // Simulate a partial run: zero the display identity but leave
        // erased=false, matching a crash between the two writes.
        const partial = await DB.db.get(`globalAuthor:${authorID}`);
        partial.name = null;
        partial.colorId = 0;
        await DB.db.set(`globalAuthor:${authorID}`, partial);

        const res = await authorManager.anonymizeAuthor(authorID);
        assert.equal(res.removedExternalMappings >= 1, true,
            `retry must still clean mapper2author; got ${res.removedExternalMappings}`);
        const record = await DB.db.get(`globalAuthor:${authorID}`);
        assert.equal(record.erased, true);
      });

  it('lastSeen is stamped when an author is created and on identity writes',
      async function () {
        const before = Date.now();
        const {authorID} = await authorManager.createAuthorIfNotExistsFor(
            `mapper-${Date.now()}-${Math.random().toString(36).slice(2)}`, 'Dora');
        const created = await DB.db.get(`globalAuthor:${authorID}`);
        assert.ok(typeof created.lastSeen === 'number',
            `lastSeen=${created.lastSeen}`);
        assert.ok(created.lastSeen >= before);

        await new Promise((r) => setTimeout(r, 5));
        await authorManager.setAuthorName(authorID, 'Dora2');
        const renamed = await DB.db.get(`globalAuthor:${authorID}`);
        assert.ok(renamed.lastSeen > created.lastSeen,
            `renamed=${renamed.lastSeen} created=${created.lastSeen}`);

        await new Promise((r) => setTimeout(r, 5));
        await authorManager.setAuthorColorId(authorID, '12');
        const recolored = await DB.db.get(`globalAuthor:${authorID}`);
        assert.ok(recolored.lastSeen > renamed.lastSeen);
      });
});
