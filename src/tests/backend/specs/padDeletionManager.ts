'use strict';

import {strict as assert} from 'assert';

const common = require('../common');
const padDeletionManager = require('../../../node/db/PadDeletionManager');

describe(__filename, function () {
  before(async function () { await common.init(); });

  const uniqueId = () => `pdmtest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  describe('createDeletionTokenIfAbsent', function () {
    it('returns a non-empty string on first call', async function () {
      const padId = uniqueId();
      const token = await padDeletionManager.createDeletionTokenIfAbsent(padId);
      assert.equal(typeof token, 'string');
      assert.ok(token.length >= 32);
      await padDeletionManager.removeDeletionToken(padId);
    });

    it('returns null on subsequent calls for the same pad', async function () {
      const padId = uniqueId();
      const first = await padDeletionManager.createDeletionTokenIfAbsent(padId);
      const second = await padDeletionManager.createDeletionTokenIfAbsent(padId);
      assert.equal(typeof first, 'string');
      assert.equal(second, null);
      await padDeletionManager.removeDeletionToken(padId);
    });

    it('emits different tokens for different pads', async function () {
      const a = uniqueId();
      const b = uniqueId();
      const tokenA = await padDeletionManager.createDeletionTokenIfAbsent(a);
      const tokenB = await padDeletionManager.createDeletionTokenIfAbsent(b);
      assert.notEqual(tokenA, tokenB);
      await padDeletionManager.removeDeletionToken(a);
      await padDeletionManager.removeDeletionToken(b);
    });
  });

  describe('isValidDeletionToken', function () {
    it('accepts the token returned by the matching pad', async function () {
      const padId = uniqueId();
      const token = await padDeletionManager.createDeletionTokenIfAbsent(padId);
      assert.equal(await padDeletionManager.isValidDeletionToken(padId, token), true);
      await padDeletionManager.removeDeletionToken(padId);
    });

    it('rejects a token for the wrong pad', async function () {
      const a = uniqueId();
      const b = uniqueId();
      const tokenA = await padDeletionManager.createDeletionTokenIfAbsent(a);
      await padDeletionManager.createDeletionTokenIfAbsent(b);
      assert.equal(await padDeletionManager.isValidDeletionToken(b, tokenA), false);
      await padDeletionManager.removeDeletionToken(a);
      await padDeletionManager.removeDeletionToken(b);
    });

    it('rejects a non-string token', async function () {
      const padId = uniqueId();
      await padDeletionManager.createDeletionTokenIfAbsent(padId);
      assert.equal(await padDeletionManager.isValidDeletionToken(padId, null), false);
      assert.equal(await padDeletionManager.isValidDeletionToken(padId, undefined), false);
      assert.equal(await padDeletionManager.isValidDeletionToken(padId, ''), false);
      await padDeletionManager.removeDeletionToken(padId);
    });

    it('returns false for pads that never had a token', async function () {
      const padId = uniqueId();
      assert.equal(await padDeletionManager.isValidDeletionToken(padId, 'anything'), false);
    });
  });

  describe('removeDeletionToken', function () {
    it('invalidates the stored token', async function () {
      const padId = uniqueId();
      const token = await padDeletionManager.createDeletionTokenIfAbsent(padId);
      await padDeletionManager.removeDeletionToken(padId);
      assert.equal(await padDeletionManager.isValidDeletionToken(padId, token), false);
    });

    it('is safe to call when no token exists', async function () {
      const padId = uniqueId();
      await padDeletionManager.removeDeletionToken(padId); // must not throw
    });
  });
});
