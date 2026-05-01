'use strict';

import {generateJWTToken} from "../common";

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const api = require('../../../node/db/API');

// Coverage for the compactPad API endpoint added in #6194.
// The underlying Cleanup logic is tested where it lives; these tests just
// verify the public-API wiring and argument handling.
describe(__filename, function () {
  let padId: string;
  let agent: any;

  before(async function () { agent = await common.init(); });

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

  // Verifies the APIHandler dispatch wiring — i.e. that `keepRevisions`
  // travels from the URL query string to the API function under the
  // right argument name. This catches regressions where the handler's
  // version map gets renamed without updating the function signature.
  describe('HTTP API dispatch (1.3.1)', function () {
    it('passes keepRevisions from query string into compactPad', async function () {
      const pad = await padManager.getPad(padId);
      for (let i = 0; i < 5; i++) await pad.appendText(`http-line-${i}\n`);

      const res = await agent.get(
          `/api/1.3.1/compactPad?padID=${padId}&keepRevisions=2`)
          .set('authorization', await generateJWTToken())
          .expect(200)
          .expect('Content-Type', /json/);

      assert.strictEqual(res.body.code, 0, JSON.stringify(res.body));
      assert.strictEqual(res.body.data.mode, 'keepLast');
      assert.strictEqual(res.body.data.keepRevisions, 2);
    });

    it('collapses all history when keepRevisions is absent from URL', async function () {
      const pad = await padManager.getPad(padId);
      for (let i = 0; i < 3; i++) await pad.appendText(`http-all-${i}\n`);

      const res = await agent.get(`/api/1.3.1/compactPad?padID=${padId}`)
          .set('authorization', await generateJWTToken())
          .expect(200)
          .expect('Content-Type', /json/);

      assert.strictEqual(res.body.code, 0, JSON.stringify(res.body));
      assert.deepStrictEqual(res.body.data, {ok: true, mode: 'all'});
    });
  });
});
