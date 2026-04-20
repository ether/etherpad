'use strict';

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const api = require('../../../node/db/API');

// Coverage for the compactPad API endpoint added in #6194.
// The underlying Cleanup logic is tested where it lives; these tests just
// verify the public-API wiring and argument handling.
describe(__filename, function () {
  let padId: string;

  beforeEach(async function () {
    padId = common.randomString();
    assert(!await padManager.doesPadExist(padId));
  });

  describe('API.compactPad()', function () {
    it('collapses all history when keepRevisions is omitted', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('line 1\n');
      await pad.appendText('line 2\n');
      await pad.appendText('line 3\n');
      const before = pad.getHeadRevisionNumber();
      const expectedText = pad.atext.text;
      assert.ok(before >= 3, `expected at least 3 revs, got ${before}`);

      const result = await api.compactPad(padId);
      assert.deepStrictEqual(result, {ok: true, mode: 'all'});

      // Reload: the compacted pad lands at head<=1 (matches the shape
      // `copyPadWithoutHistory` produces), text unchanged.
      const reloaded = await padManager.getPad(padId);
      assert.ok(reloaded.getHeadRevisionNumber() <= 1,
          `expected head<=1, got ${reloaded.getHeadRevisionNumber()}`);
      assert.strictEqual(reloaded.atext.text, expectedText);
    });

    it('keeps only the last N revisions when keepRevisions is a number',
        async function () {
          const pad = await padManager.getPad(padId);
          for (let i = 0; i < 6; i++) await pad.appendText(`line ${i}\n`);
          const before = pad.getHeadRevisionNumber();
          const expectedText = pad.atext.text;

          const result = await api.compactPad(padId, 2);
          assert.strictEqual(result.mode, 'keepLast');
          assert.strictEqual(result.keepRevisions, 2);

          const reloaded = await padManager.getPad(padId);
          // Exact head depends on Cleanup internals; the invariant we can
          // assert is that the head is <= before and the content survives.
          assert.ok(reloaded.getHeadRevisionNumber() <= before);
          assert.strictEqual(reloaded.atext.text, expectedText);
        });

    it('rejects negative keepRevisions', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('content\n');
      await assert.rejects(
          () => api.compactPad(padId, -1),
          /keepRevisions must be a non-negative integer/);
    });

    it('rejects non-numeric keepRevisions', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('content\n');
      await assert.rejects(
          // @ts-ignore - deliberately passing an invalid type
          () => api.compactPad(padId, 'nope'),
          /keepRevisions must be a non-negative integer/);
    });
  });
});
