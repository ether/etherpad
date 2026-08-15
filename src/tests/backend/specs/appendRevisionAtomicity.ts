'use strict';

// Regression coverage for #8134.
//
// appendRevision() writes the revision record and the pad record (which
// carries `head`) as two independent writes. When the revision write failed
// and the pad record landed, the pad claimed a revision that was never
// stored -- and the next successful append wrote head+1 straight over it,
// making the gap permanent. Every later pad.check() then tripped on the
// missing revision, which blocks cleanup/compaction forever.
//
// The reporter on #8134 hit exactly this: revisions 599 and 601 present,
// 600 absent, cleanup refusing to run.

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const db = require('../../../node/db/DB');

describe(__filename, function () {
  let padId: string;

  before(async function () { await common.init(); });

  beforeEach(async function () {
    padId = common.randomString();
    assert(!await padManager.doesPadExist(padId));
  });

  // Runs `fn` with the write to `failKey` rejecting.
  const withFailingWrite = async (failKey: string, fn: () => Promise<any>) => {
    const realSet = db.set;
    db.set = async (key: string, value: unknown) => {
      if (key === failKey) throw new Error('simulated backend write failure');
      return await realSet(key, value);
    };
    try {
      return await fn();
    } finally {
      db.set = realSet;
    }
  };

  describe('when the revision write fails', function () {
    it('rejects', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('one\n');
      const doomed = pad.getHeadRevisionNumber() + 1;
      await withFailingWrite(`pad:${padId}:revs:${doomed}`, async () => {
        await assert.rejects(pad.appendText('two\n'),
            /simulated backend write failure/);
      });
    });

    it('does not leave head pointing past the stored history', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('one\n');
      const goodHead = pad.getHeadRevisionNumber();
      const doomed = goodHead + 1;

      await withFailingWrite(`pad:${padId}:revs:${doomed}`, async () => {
        await assert.rejects(pad.appendText('two\n'));
      });

      assert.equal(pad.getHeadRevisionNumber(), goodHead,
          'in-memory head should be rolled back');

      padManager.unloadPad(padId);
      const padRecord = await db.get(`pad:${padId}`);
      assert.equal(padRecord.head, goodHead,
          'persisted head should be rolled back');
      assert.equal(await db.get(`pad:${padId}:revs:${doomed}`), null,
          'the failed revision should not exist');
    });

    it('rolls the in-memory text back too', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('one\n');
      const textBefore = pad.atext.text;
      const doomed = pad.getHeadRevisionNumber() + 1;

      await withFailingWrite(`pad:${padId}:revs:${doomed}`, async () => {
        await assert.rejects(pad.appendText('two\n'));
      });

      assert.equal(pad.atext.text, textBefore,
          'atext must not keep changes that were never stored');
      assert.ok(!pad.atext.text.includes('two'));
    });

    it('leaves the pad consistent for a later append', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('one\n');
      const goodHead = pad.getHeadRevisionNumber();
      const doomed = goodHead + 1;

      await withFailingWrite(`pad:${padId}:revs:${doomed}`, async () => {
        await assert.rejects(pad.appendText('two\n'));
      });

      // The next append reuses the revision number rather than skipping it.
      await pad.appendText('three\n');
      assert.equal(pad.getHeadRevisionNumber(), doomed);
      assert.notEqual(await db.get(`pad:${padId}:revs:${doomed}`), null);
    });

    it('leaves the pad passing check()', async function () {
      // The whole point: a failed write must not make the pad
      // permanently uncleanable.
      const pad = await padManager.getPad(padId);
      for (let i = 0; i < 3; i++) await pad.appendText(`line ${i}\n`);
      const doomed = pad.getHeadRevisionNumber() + 1;

      await withFailingWrite(`pad:${padId}:revs:${doomed}`, async () => {
        await assert.rejects(pad.appendText('doomed\n'));
      });
      await pad.appendText('after\n');

      padManager.unloadPad(padId);
      await (await padManager.getPad(padId)).check();
    });
  });

  describe('when the pad record write fails', function () {
    it('rejects and rolls back without orphaning head', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('one\n');
      const goodHead = pad.getHeadRevisionNumber();

      // The rollback re-saves the pad record, so let only the first
      // `pad:<id>` write fail.
      const realSet = db.set;
      let failed = false;
      db.set = async (key: string, value: unknown) => {
        if (key === `pad:${padId}` && !failed) {
          failed = true;
          throw new Error('simulated pad record write failure');
        }
        return await realSet(key, value);
      };
      try {
        await assert.rejects(pad.appendText('two\n'));
      } finally {
        db.set = realSet;
      }

      assert.equal(pad.getHeadRevisionNumber(), goodHead);
      padManager.unloadPad(padId);
      const padRecord = await db.get(`pad:${padId}`);
      assert.equal(padRecord.head, goodHead);
      // A stored-but-unreferenced revision record is harmless: check()
      // only walks 0..head.
      await (await padManager.getPad(padId)).check();
    });
  });

  describe('side effects', function () {
    it('a throwing padUpdate hook does not roll back a stored revision',
        async function () {
          // Hook failures are not storage failures. Rolling back here would
          // discard a revision that was written successfully.
          const hooks = require('../../../static/js/pluginfw/hooks');
          const pad = await padManager.getPad(padId);
          await pad.appendText('one\n');
          const goodHead = pad.getHeadRevisionNumber();

          const realACallAll = hooks.aCallAll;
          hooks.aCallAll = async (hookName: string, ...rest: any[]) => {
            if (hookName === 'padUpdate') throw new Error('plugin blew up');
            return await realACallAll(hookName, ...rest);
          };
          try {
            await assert.rejects(pad.appendText('two\n'), /plugin blew up/);
          } finally {
            hooks.aCallAll = realACallAll;
          }

          assert.equal(pad.getHeadRevisionNumber(), goodHead + 1,
              'the revision was stored, so head must stand');
          assert.notEqual(await db.get(`pad:${padId}:revs:${goodHead + 1}`), null);

          padManager.unloadPad(padId);
          await (await padManager.getPad(padId)).check();
        });
  });
});
