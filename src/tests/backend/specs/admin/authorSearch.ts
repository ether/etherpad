'use strict';

import {strict as assert} from 'assert';

const common = require('../../common');
const authorManager = require('../../../../node/db/AuthorManager');
const DB = require('../../../../node/db/DB');

describe(__filename, function () {
  before(async function () {
    this.timeout(60000);
    await common.init();
  });

  // Each spec seeds its own authors with unique mappers so they don't
  // collide with parallel runs or with whatever the rest of the suite
  // happened to leave in the dirty.db.
  const seed = async (name: string, mapper: string) =>
      (await authorManager.createAuthorIfNotExistsFor(mapper, name)).authorID;

  it('returns an empty page when the pattern matches nothing', async function () {
    const res = await authorManager.searchAuthors({
      pattern: `nonexistent-${Date.now()}-${Math.random()}`,
      offset: 0, limit: 12, sortBy: 'name', ascending: true,
      includeErased: false,
    });
    assert.equal(res.total, 0);
    assert.deepEqual(res.results, []);
  });

  it('matches by name substring', async function () {
    const tag = `findme-${Date.now()}`;
    await seed(`Alice ${tag}`, `m-${tag}-1`);
    await seed(`Bob ${tag}`,   `m-${tag}-2`);
    const res = await authorManager.searchAuthors({
      pattern: tag, offset: 0, limit: 12, sortBy: 'name', ascending: true,
      includeErased: false,
    });
    assert.equal(res.total, 2);
    assert.equal(res.results[0].name, `Alice ${tag}`);
    assert.equal(res.results[1].name, `Bob ${tag}`);
  });

  it('matches by mapper substring (joins mapper2author)', async function () {
    const tag = `mapper-tag-${Date.now()}`;
    await seed('Carol', `${tag}-x`);
    const res = await authorManager.searchAuthors({
      pattern: tag, offset: 0, limit: 12, sortBy: 'name', ascending: true,
      includeErased: false,
    });
    assert.ok(res.results.some((r: any) => r.name === 'Carol' &&
        r.mapper.some((m: string) => m.includes(tag))),
        `results=${JSON.stringify(res.results)}`);
  });

  it('hides erased authors by default and includes them when asked',
      async function () {
        const tag = `era-${Date.now()}`;
        const id = await seed(`Erasable ${tag}`, `m-${tag}`);
        // Use the authorID's random suffix as the search pattern. After
        // erasure the name is null and the mapper binding is deleted, so
        // the only remaining identifier is the opaque authorID itself.
        const idSuffix = id.substring(2, 10); // skip 'a.' prefix
        await authorManager.anonymizeAuthor(id);

        const hidden = await authorManager.searchAuthors({
          pattern: idSuffix, offset: 0, limit: 12,
          sortBy: 'name', ascending: true,
          includeErased: false,
        });
        assert.ok(!hidden.results.some((r: any) => r.authorID === id),
            `expected erased ${id} hidden, got ${JSON.stringify(hidden)}`);

        const shown = await authorManager.searchAuthors({
          pattern: idSuffix, offset: 0, limit: 12,
          sortBy: 'name', ascending: true,
          includeErased: true,
        });
        const found = shown.results.find((r: any) => r.authorID === id);
        assert.ok(found, `expected erased ${id} included, got ${JSON.stringify(shown)}`);
        assert.equal(found.erased, true);
      });

  it('sorts by lastSeen', async function () {
    const tag = `sort-${Date.now()}`;
    const a = await seed(`SortA ${tag}`, `m-${tag}-a`);
    await new Promise((r) => setTimeout(r, 10));
    const b = await seed(`SortB ${tag}`, `m-${tag}-b`);
    const asc = await authorManager.searchAuthors({
      pattern: tag, offset: 0, limit: 12, sortBy: 'lastSeen', ascending: true,
      includeErased: false,
    });
    assert.equal(asc.results[0].authorID, a);
    assert.equal(asc.results[1].authorID, b);
    const desc = await authorManager.searchAuthors({
      pattern: tag, offset: 0, limit: 12, sortBy: 'lastSeen', ascending: false,
      includeErased: false,
    });
    assert.equal(desc.results[0].authorID, b);
  });

  it('caps results at 1000 and reports cappedAt', async function () {
    this.timeout(120000);
    const tag = `cap-${Date.now()}`;
    // Seed 1100 authors directly via DB to keep this fast (~1s vs minutes
    // through createAuthorIfNotExistsFor).
    const seeded: string[] = [];
    for (let i = 0; i < 1100; i++) {
      const id = `a.${tag}-${i.toString().padStart(5, '0')}`;
      await DB.db.set(`globalAuthor:${id}`, {
        colorId: 0, name: `cap ${tag} ${i}`, timestamp: Date.now(),
        lastSeen: Date.now(),
      });
      seeded.push(id);
    }
    const res = await authorManager.searchAuthors({
      pattern: tag, offset: 0, limit: 12, sortBy: 'name', ascending: true,
      includeErased: false,
    });
    assert.equal(res.cappedAt, 1000,
        `expected cappedAt=1000, got ${res.cappedAt}`);
    assert.equal(res.total, 1000);
  });
});
