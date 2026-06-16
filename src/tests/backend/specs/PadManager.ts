'use strict';

// Unit coverage for PadManager.isValidPadId.
//
// isValidPadId is a pure function (a regex test), so this spec just requires
// PadManager and exercises it directly — no running database is needed.
// PadManager's import-time `require`s (DB, Pad, customError) only *define*
// things; the database connection happens lazily in DB.init(), so loading the
// module here has no side effects. This runs under the mocha backend suite
// (`--import=tsx`), where `require()` resolves the `.ts` sources natively.

import {strict as assert} from 'assert';

const padManager = require('../../../node/db/PadManager');

describe(__filename, function () {
  describe('isValidPadId', function () {
    it('accepts ordinary pad ids', async function () {
      for (const id of [
        'foo',
        'TF-EVC',
        'TF-LEC_IP03-EMS-CSM',
        'a.b',
        '.foo',
        'foo.',
        "a'b",
        'g.s8oes9dhwrvt0zif$bar', // group pad
      ]) {
        assert.equal(padManager.isValidPadId(id), true, `expected "${id}" to be valid`);
      }
    });

    // Regression test for "Cannot GET /p/": a pad id that is a URL dot-segment
    // ('.' or '..') is normalised away by the browser per the WHATWG URL
    // standard ('/p/.' -> '/p/', '/p/..' -> '/'), so the pad can never be
    // opened or exported. Such ids must be rejected. Before the fix
    // isValidPadId returned true for both, so this test would fail.
    it('rejects URL dot-segment pad ids that would be unreachable', async function () {
      assert.equal(padManager.isValidPadId('.'), false);
      assert.equal(padManager.isValidPadId('..'), false);
    });

    it('still rejects empty ids and ids containing "$"', async function () {
      assert.equal(padManager.isValidPadId(''), false);
      assert.equal(padManager.isValidPadId('a$b'), false);
    });
  });
});
