'use strict';

// Regression coverage for the changeset `copyPadWithoutHistory()` writes.
//
// It packed `assem.getLengthChange()` (a delta) into pack()'s `newLen`
// parameter (a total), so the resulting changeset's header disagreed with
// its own ops. Two consequences:
//
//   1. The copy came out one newline longer than the source, and grew again
//      on every subsequent copy.
//   2. The copy's revision 1 failed checkRep(), so the copied pad failed
//      pad.check() forever after -- which is exactly what `deleteRevisions`
//      (cleanup.keepRevisions / compactPad with a keep count) runs first.
//
// Because compactPad's "collapse everything" mode goes through this
// function twice, the feature meant to reclaim space left pads that could
// never be cleaned up again. Found while investigating #8134.

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const db = require('../../../node/db/DB');
const api = require('../../../node/db/API');
const settings = require('../../../node/utils/Settings');
const Changeset = require('../../../static/js/Changeset');

describe(__filename, function () {
  let cleanupEnabledBackup: boolean;

  before(async function () {
    await common.init();
    cleanupEnabledBackup = settings.cleanup.enabled;
    settings.cleanup.enabled = true;
  });

  after(function () { settings.cleanup.enabled = cleanupEnabledBackup; });

  const makeSourcePad = async (lines = 6) => {
    const padId = common.randomString();
    const pad = await padManager.getPad(padId);
    for (let i = 0; i < lines; i++) await pad.appendText(`line ${i}\n`);
    await pad.check();
    return pad;
  };

  describe('copyPadWithoutHistory()', function () {
    it('produces a copy whose text equals the source exactly', async function () {
      const src = await makeSourcePad();
      const srcText = src.atext.text;
      const dstId = common.randomString();
      await src.copyPadWithoutHistory(dstId, false);

      padManager.unloadPad(dstId);
      const dst = await padManager.getPad(dstId);
      assert.equal(dst.atext.text, srcText,
          'copy must not gain or lose characters');
    });

    it('writes a revision 1 that passes checkRep()', async function () {
      const src = await makeSourcePad();
      const dstId = common.randomString();
      await src.copyPadWithoutHistory(dstId, false);

      const rev1 = await db.get(`pad:${dstId}:revs:1`);
      assert.ok(rev1 != null, 'revision 1 should exist');
      Changeset.checkRep(rev1.changeset); // throws if malformed

      const unpacked = Changeset.unpack(rev1.changeset);
      assert.equal(unpacked.newLen, src.atext.text.length,
          'changeset header must claim the real resulting length');
    });

    it('leaves the copy passing pad.check()', async function () {
      const src = await makeSourcePad();
      const dstId = common.randomString();
      await src.copyPadWithoutHistory(dstId, false);

      padManager.unloadPad(dstId);
      await (await padManager.getPad(dstId)).check();
    });

    it('does not drift when copied repeatedly', async function () {
      // The old bug compounded: each copy added another newline.
      const src = await makeSourcePad();
      const expected = src.atext.text;

      let currentId = src.id;
      for (let i = 0; i < 3; i++) {
        const nextId = common.randomString();
        await (await padManager.getPad(currentId)).copyPadWithoutHistory(nextId, false);
        padManager.unloadPad(nextId);
        currentId = nextId;
      }
      const final = await padManager.getPad(currentId);
      assert.equal(final.atext.text, expected,
          'text must be stable across repeated copies');
      await final.check();
    });

    it('preserves author attribution on the copied text', async function () {
      const src = await makeSourcePad();
      const authors = src.getAllAuthors();
      const dstId = common.randomString();
      await src.copyPadWithoutHistory(dstId, false);

      padManager.unloadPad(dstId);
      const dst = await padManager.getPad(dstId);
      assert.deepEqual(dst.getAllAuthors().sort(), authors.sort());
    });
  });

  describe('compactPad() full collapse', function () {
    it('preserves the text and leaves the pad checkable', async function () {
      const src = await makeSourcePad();
      const padId = src.id;
      const before = src.atext.text;
      padManager.unloadPad(padId);

      assert.deepStrictEqual(await api.compactPad(padId), {ok: true, mode: 'all'});

      padManager.unloadPad(padId);
      const after = await padManager.getPad(padId);
      assert.equal(after.atext.text, before, 'compaction must not alter the text');
      await after.check();
    });

    it('leaves a pad that can still be cleaned up by keep-count', async function () {
      // deleteRevisions() calls pad.check() first, so a pad corrupted by
      // full compaction could never be compacted again.
      const src = await makeSourcePad(10);
      const padId = src.id;
      padManager.unloadPad(padId);

      await api.compactPad(padId);
      padManager.unloadPad(padId);

      const pad = await padManager.getPad(padId);
      await pad.check();
    });
  });
});
