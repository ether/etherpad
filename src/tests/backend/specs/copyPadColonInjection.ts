'use strict';

/**
 * Regression for GHSA-wg58-mhwv-35pq: copyPad/movePad/copyPadWithoutHistory
 * accepted a `destinationID` containing the ueberdb key delimiter `:`
 * (e.g. `victim:revs:0`), which bypassed the force=false overwrite guard and
 * clobbered another pad's internal revision records.
 */

const assert = require('assert').strict;
const common = require('../common');
const api = require('../../../node/db/API');
const padManager = require('../../../node/db/PadManager');

describe(__filename, function () {
  this.timeout(30000);

  before(async function () {
    await common.init();
  });

  it('rejects a copyPad destinationID that targets another pad\'s revs record', async function () {
    const victim = 'wg58_victim';
    const src = 'wg58_src';
    await padManager.getPad(victim, 'TOP-SECRET-victim-content\n');
    await padManager.getPad(src, 'attacker source\n');

    const before = await api.getRevisionChangeset(victim, '0');
    assert.ok(before, 'victim rev-0 changeset exists before the attack');

    // force=false — the whole point is that `:` bypassed the existence guard.
    await assert.rejects(
        api.copyPad(src, `${victim}:revs:0`, false),
        /valid padId|apierror/i,
        'copyPad must reject a destinationID containing ":"');

    const after = await api.getRevisionChangeset(victim, '0');
    assert.equal(after, before, 'victim rev-0 changeset must be untouched');
  });

  it('rejects copyPadWithoutHistory with a ":" destinationID', async function () {
    const src = 'wg58_src2';
    await padManager.getPad(src, 'src2\n');
    await assert.rejects(
        api.copyPadWithoutHistory(src, 'other:revs:0', false),
        /valid padId|apierror/i);
  });

  it('still allows a normal copyPad to a clean destination', async function () {
    const src = 'wg58_ok_src';
    await padManager.getPad(src, 'hello\n');
    // force=true so the test is idempotent across runs (the backend DB persists
    // pads between runs); the point here is that a valid destinationID copies.
    await api.copyPad(src, 'wg58_ok_dst', true);
    assert.ok(await padManager.doesPadExist('wg58_ok_dst'), 'destination pad exists after copy');
  });
});
