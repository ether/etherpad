'use strict';

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
import settings from '../../../node/utils/Settings';

describe(__filename, function () {
  let agent:any;
  const cleanUpPads = async () => {
    const {padIDs} = await padManager.listAllPads();
    await Promise.all(padIDs.map(async (padId: string) => {
      if (await padManager.doesPadExist(padId)) {
        const pad = await padManager.getPad(padId);
        await pad.remove();
      }
    }));
  };
  let backup:any;
  // Track every socket.io-client we open so afterEach can disconnect each
  // one. Without this, the client's 5s reconnect timer stays armed after
  // the test server tears down, keeping the event loop alive past mocha's
  // "passing" output and tripping the unclean-exit force-quit (see the
  // diagnostics.ts comment block about the Windows + Node 24 backend-test
  // flake; this spec was responsible for 3 of the 3 leaked timers seen
  // in the wtfnode dump).
  const openedSockets: any[] = [];
  const trackSocket = (s: any) => { openedSockets.push(s); return s; };

  before(async function () {
    backup = settings.lowerCasePadIds;
    agent = await common.init();
  });
  beforeEach(async function () {
    await cleanUpPads();
  });
  afterEach(async function () {
    await cleanUpPads();
    while (openedSockets.length) {
      const s = openedSockets.pop();
      try { s.disconnect(); } catch { /* socket may already be torn down */ }
    }
  });
  after(async function () {
    settings.lowerCasePadIds = backup;
  });

  describe('not activated', function () {
    beforeEach(async function () {
      settings.lowerCasePadIds = false;
    });


    it('do nothing', async function () {
      await agent.get('/p/UPPERCASEpad')
        .expect(200);
    });
  });

  describe('activated', function () {
    beforeEach(async function () {
      settings.lowerCasePadIds = true;
    });
    it('lowercase pad ids', async function () {
      await agent.get('/p/UPPERCASEpad')
        .expect(302)
        .expect('location', 'uppercasepad');
    });

    it('keeps old pads accessible', async function () {
      Object.assign(settings, {
        lowerCasePadIds: false,
      });
      await padManager.getPad('ALREADYexistingPad', 'oldpad');
      await padManager.getPad('alreadyexistingpad', 'newpad');
      Object.assign(settings, {
        lowerCasePadIds: true,
      });

      const oldPad = await agent.get('/p/ALREADYexistingPad').expect(200);
      const oldPadSocket = trackSocket(await common.connect(oldPad));
      const oldPadHandshake = await common.handshake(oldPadSocket, 'ALREADYexistingPad');
      assert.equal(oldPadHandshake.data.padId, 'ALREADYexistingPad');
      assert.equal(oldPadHandshake.data.collab_client_vars.initialAttributedText.text, 'oldpad\n');

      const newPad = await agent.get('/p/alreadyexistingpad').expect(200);
      const newPadSocket = trackSocket(await common.connect(newPad));
      const newPadHandshake = await common.handshake(newPadSocket, 'alreadyexistingpad');
      assert.equal(newPadHandshake.data.padId, 'alreadyexistingpad');
      assert.equal(newPadHandshake.data.collab_client_vars.initialAttributedText.text, 'newpad\n');
    });

    it('disallow creation of different case pad-name via socket connection', async function () {
      await padManager.getPad('maliciousattempt', 'attempt');

      const newPad = await agent.get('/p/maliciousattempt').expect(200);
      const newPadSocket = trackSocket(await common.connect(newPad));
      const newPadHandshake = await common.handshake(newPadSocket, 'MaliciousAttempt');

      assert.equal(newPadHandshake.data.collab_client_vars.initialAttributedText.text, 'attempt\n');
    });
  });
});
