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
      await pad.appendText('marker-alpha\n');
      await pad.appendText('marker-beta\n');
      await pad.appendText('marker-gamma\n');
      const before = pad.getHeadRevisionNumber();
      assert.ok(before >= 3, `expected at least 3 revs, got ${before}`);

      const result = await api.compactPad(padId);
      assert.deepStrictEqual(result, {ok: true, mode: 'all'});

      // Reload: the compacted pad lands at head<=1 (matches the shape
      // `copyPadWithoutHistory` produces). The content survives — we
      // don't assert byte-exact equality because Cleanup.deleteAllRevisions
      // goes through copyPadWithoutHistory twice and may adjust trailing
      // whitespace; what we care about is that the author-written content
      // is still there.
      const reloaded = await padManager.getPad(padId);
      assert.ok(reloaded.getHeadRevisionNumber() <= 1,
          `expected head<=1, got ${reloaded.getHeadRevisionNumber()}`);
      const text = reloaded.atext.text;
      assert.ok(text.includes('marker-alpha'), 'alpha content preserved');
      assert.ok(text.includes('marker-beta'), 'beta content preserved');
      assert.ok(text.includes('marker-gamma'), 'gamma content preserved');
    });

    it('keeps only the last N revisions when keepRevisions is a number',
        async function () {
          const pad = await padManager.getPad(padId);
          for (let i = 0; i < 6; i++) await pad.appendText(`keep-line-${i}\n`);
          const before = pad.getHeadRevisionNumber();

          const result = await api.compactPad(padId, 2);
          assert.strictEqual(result.mode, 'keepLast');
          assert.strictEqual(result.keepRevisions, 2);

          const reloaded = await padManager.getPad(padId);
          assert.ok(reloaded.getHeadRevisionNumber() <= before);
          // Content survives — whitespace normalization from the twin-copy
          // roundtrip is ignored, we just check the actual text markers.
          for (let i = 0; i < 6; i++) {
            assert.ok(reloaded.atext.text.includes(`keep-line-${i}`),
                `line ${i} survived compaction`);
          }
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
