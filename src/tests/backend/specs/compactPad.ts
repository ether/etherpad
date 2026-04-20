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
    it('no-ops an empty (head <= 0) pad', async function () {
      const pad = await padManager.getPad(padId);
      const removed = await pad.compactHistory();
      assert.strictEqual(removed, 0);
    });

    it('collapses all history into rev 0 while preserving text', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('line 1\n');
      await pad.appendText('line 2\n');
      await pad.appendText('line 3\n');
      const before = pad.getHeadRevisionNumber();
      const expectedText = pad.atext.text;
      assert.ok(before >= 3, `expected at least 3 revs, got ${before}`);

      const removed = await pad.compactHistory();

      assert.strictEqual(removed, before);
      assert.strictEqual(pad.getHeadRevisionNumber(), 0);
      // Reload from DB to confirm the collapse actually landed.
      const reloaded = await padManager.getPad(padId);
      assert.strictEqual(reloaded.getHeadRevisionNumber(), 0);
      assert.strictEqual(reloaded.atext.text, expectedText);
    });

    it('drops saved-revision bookmarks', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('content\n');
      // Push a fake savedRevision pointer — the real API would call
      // addSavedRevision but we avoid coupling the test to that API
      // surface; any non-empty array reaches the same codepath.
      // @ts-ignore — savedRevisions is private but set from JSON on load.
      pad.savedRevisions.push({revNum: pad.getHeadRevisionNumber()});
      await pad.compactHistory();
      // @ts-ignore
      assert.deepStrictEqual(pad.savedRevisions, []);
    });

    it('leaves subsequent edits appending to the collapsed base', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('first\n');
      await pad.appendText('second\n');
      await pad.compactHistory();
      assert.strictEqual(pad.getHeadRevisionNumber(), 0);
      await pad.appendText('third\n');
      assert.strictEqual(pad.getHeadRevisionNumber(), 1);
      assert.ok(pad.atext.text.includes('third'));
    });
  });

  describe('API.compactPad()', function () {
    it('returns the removed-revision count and mutates the pad in place',
        async function () {
          const pad = await padManager.getPad(padId);
          await pad.appendText('alpha\n');
          await pad.appendText('beta\n');
          const before = pad.getHeadRevisionNumber();
          const result = await api.compactPad(padId);
          assert.strictEqual(result.removed, before);
          assert.strictEqual(pad.getHeadRevisionNumber(), 0);
        });
  });
});
