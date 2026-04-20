'use strict';

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const api = require('../../../node/db/API');

// Regression + behavior tests for https://github.com/ether/etherpad/issues/6194.
describe(__filename, function () {
  let padId: string;

  beforeEach(async function () {
    padId = common.randomString();
    assert(!await padManager.doesPadExist(padId));
  });

  describe('pad.compactHistory()', function () {
    it('no-ops a pad that is already at head <= 1', async function () {
      const pad = await padManager.getPad(padId);
      // Fresh pads land at head=0 (just the defaultText rev); compactHistory
      // has nothing useful to do on a pad that short.
      const removed = await pad.compactHistory();
      assert.strictEqual(removed, 0);
    });

    it('collapses history to head<=1 while preserving text', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('line 1\n');
      await pad.appendText('line 2\n');
      await pad.appendText('line 3\n');
      const before = pad.getHeadRevisionNumber();
      const expectedText = pad.atext.text;
      assert.ok(before >= 3, `expected at least 3 revs, got ${before}`);

      const removed = await pad.compactHistory();

      // The collapsed pad matches the shape of a freshly-imported pad
      // (head=1: a seed rev + the full-content rev). Exact count depends
      // on whether the defaultText-init counted as rev 0, but the
      // invariant is `head <= 1`.
      const afterHead = pad.getHeadRevisionNumber();
      assert.ok(afterHead <= 1, `expected head<=1 after compact, got ${afterHead}`);
      assert.strictEqual(removed, before - afterHead);
      assert.strictEqual(pad.atext.text, expectedText);
      // Reload from DB to confirm the collapse actually landed.
      const reloaded = await padManager.getPad(padId);
      assert.strictEqual(reloaded.getHeadRevisionNumber(), afterHead);
      assert.strictEqual(reloaded.atext.text, expectedText);
    });

    it('drops saved-revision bookmarks', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('content line 1\n');
      await pad.appendText('content line 2\n');
      // @ts-ignore — savedRevisions is private but set from JSON on load.
      pad.savedRevisions.push({revNum: pad.getHeadRevisionNumber()});
      await pad.compactHistory();
      // @ts-ignore
      assert.deepStrictEqual(pad.savedRevisions, []);
    });

    it('leaves subsequent edits appending cleanly on top of the collapsed base', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('first\n');
      await pad.appendText('second\n');
      await pad.appendText('third\n');
      await pad.compactHistory();
      const postCompactHead = pad.getHeadRevisionNumber();
      await pad.appendText('fourth\n');
      assert.strictEqual(pad.getHeadRevisionNumber(), postCompactHead + 1);
      assert.ok(pad.atext.text.includes('fourth'),
          `expected "fourth" in post-compact text: ${pad.atext.text}`);
    });
  });

  describe('API.compactPad()', function () {
    it('reports the number of revisions removed and compacts the pad',
        async function () {
          const pad = await padManager.getPad(padId);
          await pad.appendText('alpha\n');
          await pad.appendText('beta\n');
          await pad.appendText('gamma\n');
          const before = pad.getHeadRevisionNumber();
          const result = await api.compactPad(padId);
          const afterHead = pad.getHeadRevisionNumber();
          assert.ok(afterHead <= 1);
          assert.strictEqual(result.removed, before - afterHead);
        });
  });
});
