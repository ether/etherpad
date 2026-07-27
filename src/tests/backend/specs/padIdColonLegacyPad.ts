'use strict';

/**
 * GHSA-wg58-mhwv-35pq made `:` invalid in a pad id. `:` was legal before, so
 * pads carrying one exist in the wild (padIdTransforms maps `:` -> `_` precisely
 * to keep those reachable). Rejecting them outright would lock their content
 * away, so an invalid id is only refused when no pad with that exact id exists.
 *
 * The injection primitive the advisory closes stays closed: doesPadExist()
 * requires a top-level `atext`, which only a real pad record has — the
 * `pad:<id>:revs:<n>` sub-records an injected id addresses do not have one.
 */

const assert = require('assert').strict;
const common = require('../common');
const db = require('../../../node/db/DB');
const padManager = require('../../../node/db/PadManager');

const LEGACY_ID = 'wg58legacy:pad';

let agent: any;

describe(__filename, function () {
  this.timeout(30000);

  before(async function () {
    agent = await common.init();
    // Plant a legacy pad the way an old Etherpad would have stored it: `:` in the
    // id is no longer creatable through getPad(), so write the record directly.
    const donor = await padManager.getPad('wg58legacy_donor', 'legacy content\n');
    await donor.saveToDatabase();
    await db.set(`pad:${LEGACY_ID}`, await db.get('pad:wg58legacy_donor'));
    padManager.unloadPad(LEGACY_ID);
  });

  it('getPad still serves an existing pad whose id contains ":"', async function () {
    const pad = await padManager.getPad(LEGACY_ID);
    assert.equal(pad.id, LEGACY_ID);
    assert.match(pad.text(), /legacy content/);
  });

  it('the legacy pad URL is not 404ed', async function () {
    const res = await agent.get(`/p/${encodeURIComponent(LEGACY_ID)}`);
    assert.notEqual(res.status, 404, 'an existing legacy pad must stay reachable');
  });

  it('getPad still rejects a ":" id that is not an existing pad', async function () {
    // The injection target: `pad:<victim>:revs:0` exists as a db record but is not
    // a pad (no top-level atext), so it must not be addressable as a pad id.
    const victim = await padManager.getPad('wg58legacy_victim', 'victim\n');
    await victim.saveToDatabase();
    assert.ok(await db.get('pad:wg58legacy_victim:revs:0'), 'victim rev-0 record exists');
    await assert.rejects(
        padManager.getPad('wg58legacy_victim:revs:0'),
        /valid padId|apierror/i);
  });
});
