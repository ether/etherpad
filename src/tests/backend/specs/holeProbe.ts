'use strict';

// Probe: are there hole-forming paths other than appendRevision (#8134)?

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const db = require('../../../node/db/DB');
const settings = require('../../../node/utils/Settings');
const {deleteRevisions} = require('../../../node/utils/Cleanup');

const missingRevs = async (padId: string) => {
  const rec = await db.get(`pad:${padId}`);
  const missing = [];
  for (let r = 0; r <= rec.head; r++) {
    if (await db.get(`pad:${padId}:revs:${r}`) == null) missing.push(r);
  }
  return {head: rec.head, missing};
};

describe(__filename, function () {
  let backup: boolean;
  before(async function () {
    await common.init();
    backup = settings.cleanup.enabled;
    settings.cleanup.enabled = true;
  });
  after(function () { settings.cleanup.enabled = backup; });

  it('MECHANISM 2: a failed write during deleteRevisions leaves holes',
      async function () {
        const padId = common.randomString();
        const pad = await padManager.getPad(padId);
        for (let i = 0; i < 12; i++) await pad.appendText(`line ${i}\n`);
        const headBefore = pad.getHeadRevisionNumber();

        // deleteRevisions removes every revision, then rewrites the kept
        // ones. Fail one of the rewrites.
        const realSet = db.set;
        db.set = async (key: string, value: unknown) => {
          if (key === `pad:${padId}:revs:2`) throw new Error('boom');
          return await realSet(key, value);
        };
        let threw = false;
        try {
          await deleteRevisions(padId, 3);
        } catch { threw = true; } finally { db.set = realSet; }

        padManager.unloadPad(padId);
        const state = await missingRevs(padId);
        console.log(`  head before=${headBefore}; after: head=${state.head} ` +
                    `missing=[${state.missing}] threw=${threw}`);
        assert.ok(state.missing.length > 0,
            'expected deleteRevisions to leave holes');
      });

  it('MECHANISM 3: a stale in-memory pad appends past the rewritten head',
      async function () {
        const padId = common.randomString();
        const pad = await padManager.getPad(padId);
        for (let i = 0; i < 12; i++) await pad.appendText(`line ${i}\n`);
        const staleHead = pad.getHeadRevisionNumber();

        // Fail late, after the pad record has been rewritten to the new head.
        const realSet = db.set;
        db.set = async (key: string, value: unknown) => {
          if (key === `pad:${padId}:revs:3`) throw new Error('boom');
          return await realSet(key, value);
        };
        try { await deleteRevisions(padId, 3); } catch { /* expected */ }
        finally { db.set = realSet; }

        const recAfter = await db.get(`pad:${padId}`);
        console.log(`  stale in-memory head=${pad.getHeadRevisionNumber()}, ` +
                    `persisted head=${recAfter.head}`);

        // The caller still holds the old Pad object. One more edit through it:
        try { await pad.appendText('later edit\n'); } catch { /* may throw */ }

        padManager.unloadPad(padId);
        const state = await missingRevs(padId);
        console.log(`  final: head=${state.head} missing=[${state.missing}]`);
        assert.ok(state.missing.length > 0, 'expected holes');
      });
});
