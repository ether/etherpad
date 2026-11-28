'use strict';

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
import settings from '../../../node/utils/Settings';

// Issue #8573: with updates.tier "off" the server does not register
// GET /api/version-status, so clientVars.updateCheck must tell the pad client
// to skip that request. Every other tier keeps the check on.
describe(__filename, function () {
  this.timeout(30000);
  let agent: any;
  let socket: any;
  let tierBackup: typeof settings.updates.tier;
  const padId = 'updateCheckClientVar';

  const removePad = async () => {
    if (await padManager.doesPadExist(padId)) await (await padManager.getPad(padId)).remove();
  };

  const clientVarsFor = async () => {
    const res = await agent.get(`/p/${padId}`).expect(200);
    socket = await common.connect(res);
    const cv: any = await common.handshake(socket, padId);
    assert.equal(cv.type, 'CLIENT_VARS');
    return cv.data;
  };

  before(async function () { agent = await common.init(); });
  beforeEach(async function () {
    tierBackup = settings.updates.tier;
    await removePad();
  });
  afterEach(async function () {
    if (socket) socket.close();
    socket = null;
    settings.updates.tier = tierBackup;
    await removePad();
  });

  it('is false when updates.tier is "off"', async function () {
    settings.updates.tier = 'off';
    assert.equal((await clientVarsFor()).updateCheck, false);
  });

  for (const tier of ['notify', 'manual', 'auto', 'autonomous'] as const) {
    it(`is true when updates.tier is "${tier}"`, async function () {
      settings.updates.tier = tier;
      assert.equal((await clientVarsFor()).updateCheck, true);
    });
  }
});
