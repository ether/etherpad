'use strict';

// Cleanup should report a damaged history as a damaged history.
//
// Before this, deleteRevisions() went straight into pad.check(), which
// replays the whole history and dies on `assert(timestamp != null)` --
// an assertion about a null timestamp, when what the operator needs to
// hear is "revision 600 is missing, here is what to do about it". The
// reporter on #8134 had to bisect their database by hand.

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const db = require('../../../node/db/DB');
const settings = require('../../../node/utils/Settings');
const {deleteRevisions, deleteAllRevisions} = require('../../../node/utils/Cleanup');

describe(__filename, function () {
  let padId: string;
  let cleanupEnabledBackup: boolean;

  before(async function () {
    await common.init();
    cleanupEnabledBackup = settings.cleanup.enabled;
    settings.cleanup.enabled = true;
  });

  after(function () { settings.cleanup.enabled = cleanupEnabledBackup; });

  beforeEach(async function () {
    padId = common.randomString();
    assert(!await padManager.doesPadExist(padId));
  });

  const padWithHoles = async (holes: number[], revs = 12) => {
    const pad = await padManager.getPad(padId);
    for (let i = 0; i < revs; i++) await pad.appendText(`line ${i}\n`);
    for (const h of holes) await db.remove(`pad:${padId}:revs:${h}`, null);
    padManager.unloadPad(padId);
    return await padManager.getPad(padId);
  };

  describe('Pad.findMissingRevisions()', function () {
    it('returns [] for a healthy pad', async function () {
      const pad = await padWithHoles([]);
      assert.deepEqual(await pad.findMissingRevisions(), []);
    });

    it('finds a single gap', async function () {
      const pad = await padWithHoles([3]);
      assert.deepEqual(await pad.findMissingRevisions(), [3]);
    });

    it('finds several gaps, in ascending order', async function () {
      const pad = await padWithHoles([7, 2, 5]);
      assert.deepEqual(await pad.findMissingRevisions(), [2, 5, 7]);
    });

    it('honours the limit', async function () {
      const pad = await padWithHoles([2, 3, 4, 5, 6]);
      const found = await pad.findMissingRevisions(2);
      assert.equal(found.length, 2);
      assert.deepEqual(found, [2, 3]);
    });

    it('does not report revisions beyond head', async function () {
      const pad = await padWithHoles([]);
      const head = pad.getHeadRevisionNumber();
      await db.remove(`pad:${padId}:revs:${head + 5}`, null); // no-op
      assert.deepEqual(await pad.findMissingRevisions(), []);
    });
  });

  describe('deleteRevisions() on a damaged pad', function () {
    it('names the missing revision instead of asserting', async function () {
      await padWithHoles([3]);
      padManager.unloadPad(padId);
      const err: any = await deleteRevisions(padId, 2).then(() => null, (e: any) => e);
      assert.ok(err != null, 'expected deleteRevisions to throw');
      assert.match(err.message, /missing revision\(s\) 3\b/);
      assert.match(err.message, new RegExp(padId));
      // Not a bare assertion failure any more.
      assert.ok(!/timestamp != null/.test(err.message),
          `still surfacing the raw assertion:\n${err.message}`);
    });

    it('tells the operator their text is safe and how to recover',
        async function () {
          await padWithHoles([3]);
          padManager.unloadPad(padId);
          const err: any =
              await deleteRevisions(padId, 2).then(() => null, (e: any) => e);
          assert.match(err.message, /current text is unaffected/i);
          assert.match(err.message, /compactPad/);
        });

    it('lists multiple gaps', async function () {
      await padWithHoles([3, 6]);
      padManager.unloadPad(padId);
      const err: any = await deleteRevisions(padId, 2).then(() => null, (e: any) => e);
      assert.match(err.message, /missing revision\(s\) 3, 6/);
    });

    it('leaves the damaged pad untouched', async function () {
      // The whole point of failing before the destructive phase.
      const pad = await padWithHoles([3]);
      const headBefore = pad.getHeadRevisionNumber();
      const textBefore = pad.atext.text;
      padManager.unloadPad(padId);

      await deleteRevisions(padId, 2).catch(() => {});

      padManager.unloadPad(padId);
      const after = await padManager.getPad(padId);
      assert.equal(after.getHeadRevisionNumber(), headBefore);
      assert.equal(after.atext.text, textBefore);
    });

    it('still cleans up a healthy pad', async function () {
      const pad = await padWithHoles([]);
      padManager.unloadPad(padId);
      assert.equal(await deleteRevisions(padId, 3), true);
      padManager.unloadPad(padId);
      await (await padManager.getPad(padId)).check();
    });
  });

  describe('full compaction is still allowed', function () {
    it('deleteAllRevisions works on a damaged pad', async function () {
      // This is the recovery path the error message points at, so it must
      // not be gated behind the same check.
      const pad = await padWithHoles([3]);
      const textBefore = pad.atext.text;
      padManager.unloadPad(padId);

      await deleteAllRevisions(padId);

      padManager.unloadPad(padId);
      const after = await padManager.getPad(padId);
      // Compared trimmed: on develop, copyPadWithoutHistory still appends a
      // newline per copy (issue #8139, fixed by #8140), and this spec is
      // deliberately independent of that one. What matters here is that the
      // recovery path runs at all on a pad the keep-count path refuses.
      assert.equal(after.atext.text.trimEnd(), textBefore.trimEnd(),
          'author-written text preserved');
      assert.deepEqual(await after.findMissingRevisions(), [],
          'history rebuilt without gaps');
    });
  });
});
