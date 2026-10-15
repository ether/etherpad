'use strict';

import {strict as assert} from 'assert';
import log4js from 'log4js';
import sinon from 'sinon';

const common = require('../common');
const db = require('../../../node/db/DB');
const groupManager = require('../../../node/db/GroupManager');
const padManager = require('../../../node/db/PadManager');
import readOnlyManager from '../../../node/db/ReadOnlyManager';
const settings = require('../../../node/utils/Settings');
const padRetention = require('../../../node/utils/PadRetention');

const DAY_MS = 24 * 60 * 60 * 1000;

// Coverage for settings.padRetention: deleting pads nobody has edited for
// deleteAfterDays, via the sweep and when a client opens the pad.
describe(__filename, function () {
  let agent: any;
  let backup: any;

  const cfgFor = (overrides: any = {}) => padRetention.parseConfig({
    enabled: true,
    dryRun: false,
    deleteAfterDays: 30,
    warnBeforeDays: 7,
    sweepIntervalHours: 1,
    excludeGroupPads: true,
    excludePattern: null,
    ...overrides,
  });

  // Makes a pad look like its last edit was `daysAgo` days ago by rewriting
  // the head revision's timestamp, which is what retention reads.
  const makePad = async (daysAgo: number, padId = `retention_${common.randomString()}`) => {
    const pad = await padManager.getPad(padId, 'some text\n');
    await pad.appendText('an edit\n');
    await db.setSub(`pad:${padId}:revs:${pad.getHeadRevisionNumber()}`, ['meta', 'timestamp'],
        Date.now() - daysAgo * DAY_MS);
    return padId;
  };

  before(async function () {
    agent = await common.init();
    backup = settings.padRetention;
  });

  afterEach(function () {
    padRetention.stop();
    settings.padRetention = backup;
  });

  describe('parseConfig()', function () {
    it('is null when the feature is off', function () {
      assert.equal(padRetention.parseConfig({enabled: false, deleteAfterDays: 30}), null);
      assert.equal(padRetention.parseConfig(undefined), null);
    });

    it('defaults to dry run', function () {
      const cfg = padRetention.parseConfig({enabled: true, deleteAfterDays: 30});
      assert.equal(cfg.dryRun, true);
      assert.equal(cfg.excludeGroupPads, true);
    });

    for (const [name, bad] of [
      ['deleteAfterDays = 0', {deleteAfterDays: 0}],
      ['negative deleteAfterDays', {deleteAfterDays: -5}],
      ['string deleteAfterDays', {deleteAfterDays: '30'}],
      ['negative warnBeforeDays', {warnBeforeDays: -1}],
      ['sweepIntervalHours = 0', {sweepIntervalHours: 0}],
      ['an invalid regex', {excludePattern: '(unclosed'}],
    ] as [string, any][]) {
      it(`rejects ${name}`, function () {
        assert.throws(() => cfgFor(bad), /padRetention\./);
      });
    }

    it('start() logs an error and stays off when the config is invalid', async function () {
      const errorSpy = sinon.spy(log4js.getLogger('padRetention').constructor.prototype, 'error');
      try {
        settings.padRetention = {...backup, enabled: true, dryRun: false, deleteAfterDays: -1};
        padRetention.start();
        const messages = errorSpy.getCalls()
            .filter((c: any) => c.thisValue.category === 'padRetention')
            .map((c: any) => String(c.args[0]));
        assert(messages.some((m) => m.includes('deleteAfterDays')), JSON.stringify(messages));
      } finally {
        errorSpy.restore();
      }
      // Nothing is deleted on open either.
      const padId = await makePad(100);
      assert.equal(await padRetention.checkOnOpen(padId), null);
      assert(await padManager.doesPadExist(padId));
    });
  });

  describe('checkPad()', function () {
    it('expires a pad last edited before deleteAfterDays', async function () {
      const padId = await makePad(31);
      assert.equal((await padRetention.checkPad(padId, cfgFor())).action, 'expire');
    });

    it('keeps a pad edited recently', async function () {
      const padId = await makePad(2);
      const result = await padRetention.checkPad(padId, cfgFor());
      assert.equal(result.action, 'keep');
      assert(Math.abs(result.expiresAt - (Date.now() + 28 * DAY_MS)) < 60 * 1000);
    });

    it('counts a never-edited pad from when it was created', async function () {
      const padId = `retention_${common.randomString()}`;
      const pad = await padManager.getPad(padId);
      assert.equal(pad.getHeadRevisionNumber(), 0);
      assert.equal((await padRetention.checkPad(padId, cfgFor())).action, 'keep');
      await db.setSub(`pad:${padId}:revs:0`, ['meta', 'timestamp'], Date.now() - 31 * DAY_MS);
      assert.equal((await padRetention.checkPad(padId, cfgFor())).action, 'expire');
    });

    it('keeps a pad whose last edit is in the future (clock skew)', async function () {
      const padId = await makePad(-3);
      assert.equal((await padRetention.checkPad(padId, cfgFor())).action, 'keep');
    });

    it('skips group pads unless excludeGroupPads is false', async function () {
      const {groupID} = await groupManager.createGroup();
      const {padID: padId} = await groupManager.createGroupPad(groupID, 'retention');
      await makePad(100, padId);
      assert.deepEqual(await padRetention.checkPad(padId, cfgFor()),
          {action: 'skip', reason: 'group pad'});
      const cfg = cfgFor({excludeGroupPads: false});
      assert.equal((await padRetention.checkPad(padId, cfg)).action, 'expire');
      // Deleting it also removes it from the group.
      assert(await padRetention.expirePad(padId, cfg));
      assert.equal(await padManager.doesPadExist(padId), false);
      assert.deepEqual((await db.get(`group:${groupID}`)).pads, {});
    });

    it('skips pads matching excludePattern', async function () {
      const padId = await makePad(100, `retention_keepme_${common.randomString()}`);
      const cfg = cfgFor({excludePattern: '^retention_keepme_'});
      assert.deepEqual(await padRetention.checkPad(padId, cfg),
          {action: 'skip', reason: 'excludePattern'});
    });

    it('skips a pad that does not exist', async function () {
      assert.equal(
          (await padRetention.checkPad(`retention_${common.randomString()}`, cfgFor())).action,
          'skip');
    });
  });

  describe('sweep()', function () {
    it('deletes expired pads and keeps fresh ones', async function () {
      const oldPad = await makePad(31);
      const freshPad = await makePad(1);
      const roId = await readOnlyManager.getReadOnlyId(oldPad);
      const report = await padRetention.sweep(cfgFor());
      assert(report.deleted >= 1);
      assert.equal(await padManager.doesPadExist(oldPad), false);
      // Missing keys come back as null or undefined depending on the database.
      assert((await db.get(`pad:${oldPad}:revs:0`)) == null);
      assert((await db.get(`readonly2pad:${roId}`)) == null);
      assert(await padManager.doesPadExist(freshPad));
    });

    it('carries on past a pad whose revision record is broken', async function () {
      const broken = await makePad(31);
      const oldPad = await makePad(31);
      // Simulate a revision record the database can't read.
      const getSub = db.getSub;
      const stub = sinon.stub(db, 'getSub').callsFake(async (...args: any[]) => {
        if (String(args[0]).startsWith(`pad:${broken}:`)) throw new Error('corrupt revision');
        return await getSub(...args);
      });
      try {
        const report = await padRetention.sweep(cfgFor());
        assert(report.errors >= 1);
      } finally {
        stub.restore();
      }
      assert.equal(await padManager.doesPadExist(oldPad), false);
    });

    it('deletes nothing in dry run and logs each pad', async function () {
      const padId = await makePad(31);
      const infoSpy = sinon.spy(log4js.getLogger('padRetention').constructor.prototype, 'info');
      try {
        const report = await padRetention.sweep(cfgFor({dryRun: true}));
        assert(report.deleted >= 1);
        const messages = infoSpy.getCalls()
            .filter((c: any) => c.thisValue.category === 'padRetention')
            .map((c: any) => String(c.args[0]));
        assert(messages.some((m) => m.includes(`would delete pad ${padId}`)),
            JSON.stringify(messages));
      } finally {
        infoSpy.restore();
      }
      assert(await padManager.doesPadExist(padId));
    });

    it('stops between pads when cancelled', async function () {
      await makePad(31);
      const report = await padRetention.sweep(cfgFor({dryRun: true}), () => true);
      assert.equal(report.checked, 0);
    });
  });

  describe('CLIENT_READY', function () {
    const openPad = async (padId: string) => {
      const res = await agent.get(`/p/${padId}`).expect(200);
      const socket = await common.connect(res);
      try {
        const {type, data} = await common.handshake(socket, padId);
        assert.equal(type, 'CLIENT_VARS');
        return data;
      } finally {
        socket.close();
      }
    };

    const enable = (overrides: any = {}) => {
      settings.padRetention = {
        enabled: true, dryRun: false, deleteAfterDays: 30, warnBeforeDays: 7,
        sweepIntervalHours: 1, excludeGroupPads: true, excludePattern: null, ...overrides,
      };
      padRetention.start();
    };

    it('sends null when the feature is off', async function () {
      const padId = await makePad(100);
      const clientVars = await openPad(padId);
      assert.equal(clientVars.padRetention, null);
      assert(clientVars.collab_client_vars.initialAttributedText.text.includes('an edit'));
    });

    it('deletes an overdue pad and opens a new one in its place', async function () {
      enable();
      const padId = await makePad(31);
      const clientVars = await openPad(padId);
      assert.deepEqual(clientVars.padRetention, {state: 'expired', deleteAfterDays: 30});
      assert(!clientVars.collab_client_vars.initialAttributedText.text.includes('an edit'));
      assert.equal(clientVars.collab_client_vars.rev, 0);
    });

    it('warns when the pad is inside warnBeforeDays', async function () {
      enable();
      const padId = await makePad(25);
      const clientVars = await openPad(padId);
      assert.equal(clientVars.padRetention.state, 'expiring');
      const expected = 5 * DAY_MS;
      assert(Math.abs(clientVars.padRetention.msRemaining - expected) < 60 * 1000,
          `msRemaining=${clientVars.padRetention.msRemaining}`);
    });

    it('says nothing for a pad outside the warning window', async function () {
      enable();
      const padId = await makePad(1);
      assert.equal((await openPad(padId)).padRetention, null);
    });

    it('neither deletes nor warns in dry run', async function () {
      enable({dryRun: true});
      const padId = await makePad(31);
      const clientVars = await openPad(padId);
      assert.equal(clientVars.padRetention, null);
      assert(clientVars.collab_client_vars.initialAttributedText.text.includes('an edit'));
    });
  });
});
