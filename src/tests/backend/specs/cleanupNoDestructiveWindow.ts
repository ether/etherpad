'use strict';

// deleteRevisions() must not be able to damage the pad it is cleaning.
//
// It used to remove every revision 0..head and only then write the
// replacements. A failure anywhere in that window left the pad with holes,
// or with no history at all, while the pad record still claimed them. And
// because the cached Pad was only unloaded on the success path, a failed
// cleanup left an object carrying the pre-cleanup head -- one more edit
// through it appended at the OLD head and punched a whole run of holes.
//
// Measured on develop before this change: a cleanup that failed one write,
// plus a single subsequent edit, took a 12-revision pad to head=13 with
// revisions 3..12 all missing.
//
// Found while investigating #8134.

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const db = require('../../../node/db/DB');
const settings = require('../../../node/utils/Settings');
const {deleteRevisions} = require('../../../node/utils/Cleanup');

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

  const makePad = async (revs = 12) => {
    const pad = await padManager.getPad(padId);
    for (let i = 0; i < revs; i++) await pad.appendText(`line ${i}\n`);
    return pad;
  };

  // Revision numbers in [0, head] with no stored record.
  const holes = async () => {
    const rec = await db.get(`pad:${padId}`);
    const missing = [];
    for (let r = 0; r <= rec.head; r++) {
      if (await db.get(`pad:${padId}:revs:${r}`) == null) missing.push(r);
    }
    return {head: rec.head, missing};
  };

  const withFailingWrite = async (failKey: string, fn: () => Promise<any>) => {
    const realSet = db.set;
    db.set = async (key: string, value: unknown) => {
      if (key === failKey) throw new Error('simulated write failure');
      return await realSet(key, value);
    };
    try { return await fn(); } finally { db.set = realSet; }
  };

  it('a failed rewrite leaves no holes', async function () {
    await makePad();
    padManager.unloadPad(padId);

    await withFailingWrite(`pad:${padId}:revs:2`,
        async () => { await deleteRevisions(padId, 3).catch(() => {}); });

    const {head, missing} = await holes();
    assert.deepEqual(missing, [],
        `cleanup left holes: head=${head} missing=[${missing}]`);
  });

  it('a failed rewrite leaves a pad that full compaction can repair',
      async function () {
        // Honest about the limit here. ueberdb offers no transaction across
        // the rewrite, so a failure part-way still leaves revisions
        // 0..keepRevisions holding rebuilt content while `head` is not yet
        // moved onto them -- check() fails on a content mismatch. What it no
        // longer leaves is a *hole*, which is the unrecoverable state: gaps
        // cannot be reconstructed, whereas a mismatch is fixed by rebuilding
        // the history from the current text.
        const {deleteAllRevisions} = require('../../../node/utils/Cleanup');
        await makePad();
        padManager.unloadPad(padId);

        await withFailingWrite(`pad:${padId}:revs:2`,
            async () => { await deleteRevisions(padId, 3).catch(() => {}); });

        assert.deepEqual((await holes()).missing, [], 'no holes');

        await deleteAllRevisions(padId);
        padManager.unloadPad(padId);
        const repaired = await padManager.getPad(padId);
        assert.deepEqual((await holes()).missing, [], 'history rebuilt intact');
        assert.ok(repaired.atext.text.includes('line 11'), 'content preserved');
        // Not asserting repaired.check() here: on develop full compaction
        // still writes an invalid revision 1 (#8139, fixed by #8140), and
        // this spec is deliberately independent of that one.
      });

  it('a failed cleanup does not leave a stale pad that can append past head',
      async function () {
        // The 10-hole case. Hold a reference the way a caller would, let
        // cleanup fail, then keep editing.
        const pad = await makePad();

        await withFailingWrite(`pad:${padId}:revs:3`,
            async () => { await deleteRevisions(padId, 3).catch(() => {}); });

        // Whatever happened, an edit afterwards must not create holes.
        await (await padManager.getPad(padId)).appendText('later edit\n')
            .catch(() => {});

        const {head, missing} = await holes();
        assert.deepEqual(missing, [],
            `stale-pad append left holes: head=${head} missing=[${missing}]`);
      });

  it('the cached pad is dropped even when cleanup fails', async function () {
    await makePad();
    await withFailingWrite(`pad:${padId}:revs:2`,
        async () => { await deleteRevisions(padId, 3).catch(() => {}); });

    // A fresh getPad must read the pad record rather than hand back the
    // pre-cleanup object.
    const rec = await db.get(`pad:${padId}`);
    const reloaded = await padManager.getPad(padId);
    assert.equal(reloaded.getHeadRevisionNumber(), rec.head,
        'getPad returned a pad whose head disagrees with storage');
  });

  it('a successful cleanup still keeps the last N revisions and checks out',
      async function () {
        const pad = await makePad();
        const textBefore = pad.atext.text;
        padManager.unloadPad(padId);

        assert.equal(await deleteRevisions(padId, 3), true);

        padManager.unloadPad(padId);
        const after = await padManager.getPad(padId);
        assert.equal(after.getHeadRevisionNumber(), 3);
        assert.equal(after.atext.text, textBefore, 'text preserved');
        assert.deepEqual((await holes()).missing, []);
        await after.check();
      });

  it('a successful cleanup removes the orphaned revisions', async function () {
    await makePad();
    padManager.unloadPad(padId);
    assert.equal(await deleteRevisions(padId, 3), true);

    // Everything above the new head should be gone, not left as litter.
    for (const r of [4, 5, 8, 12]) {
      assert.ok(await db.get(`pad:${padId}:revs:${r}`) == null,
          `revision ${r} should have been removed`);
    }
  });
});
