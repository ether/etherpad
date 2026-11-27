'use strict';

import {strict as assert} from 'assert';
import path from 'path';
import setCookieParser from 'set-cookie-parser';

const io = require('socket.io-client');
const common = require('../../common');
const settings = require('../../../../node/utils/Settings');

// Issue #8573: with updates.tier "off" the server does not register
// /admin/update/status, so the admin UI learns the tier from the /settings
// socket's `settings` payload (flags.updatesTier) and skips that request.
// The help payload also says whether privacy.updateCheck is on, so the help
// page does not claim "update available: undefined" when it is off.
const adminSocket = async () => {
  settings.users = settings.users || {};
  settings.users['test-admin'] = {password: 'test-admin-password', is_admin: true};
  const savedRequireAuthentication = settings.requireAuthentication;
  settings.requireAuthentication = true;
  let res: any;
  try {
    res = await (common.agent as any)
        .get('/admin/')
        .auth('test-admin', 'test-admin-password');
  } finally {
    settings.requireAuthentication = savedRequireAuthentication;
  }
  const resCookies = setCookieParser.parse(res, {map: true});
  const reqCookieHdr = Object.entries(resCookies)
      .map(([name, cookie]: [string, any]) =>
          `${name}=${encodeURIComponent(cookie.value)}`)
      .join('; ');
  const socket = io(`${common.baseUrl}/settings`, {
    forceNew: true,
    query: {cookie: reqCookieHdr},
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
};

const ask = (socket: any, evt: string, replyEvt: string, budgetMs = 10000) =>
  new Promise<any>((resolve, reject) => {
    const timer = setTimeout(
        () => reject(new Error(`no ${replyEvt} reply within ${budgetMs}ms`)), budgetMs);
    socket.once(replyEvt, (data: any) => { clearTimeout(timer); resolve(data); });
    socket.emit(evt);
  });

describe(__filename, function () {
  this.timeout(60000);
  let socket: any;
  let savedUsers: any;
  let savedTier: string;
  let savedUpdateCheck: boolean;
  let savedSettingsFilename: string;
  let setupCompleted = false;

  before(async function () {
    await common.init();
    savedUsers = settings.users;
    savedTier = settings.updates.tier;
    savedUpdateCheck = settings.privacy.updateCheck;
    savedSettingsFilename = settings.settingsFilename;
    // `load` reads the settings file from disk; CI has no settings.json, so
    // point it at the template for the duration of this suite.
    settings.settingsFilename = path.join(settings.root, 'settings.json.template');
    setupCompleted = true;
    try {
      socket = await adminSocket();
      // An authenticate-hook plugin can refuse the plain-text test admin
      // (see anonymizeAuthorSocket.ts); skip rather than hang in that case.
      await ask(socket, 'load', 'settings', 15000);
    } catch (err: any) {
      console.warn(`[updatesTierFlag] admin socket unavailable (${err?.message}); skipping`);
      this.skip();
    }
  });

  after(function () {
    if (socket) socket.disconnect();
    if (!setupCompleted) return;
    settings.updates.tier = savedTier;
    settings.privacy.updateCheck = savedUpdateCheck;
    settings.settingsFilename = savedSettingsFilename;
    if (settings.users) delete settings.users['test-admin'];
    settings.users = savedUsers;
  });

  for (const tier of ['off', 'notify', 'manual', 'auto', 'autonomous']) {
    it(`settings payload reports flags.updatesTier = "${tier}"`, async function () {
      settings.updates.tier = tier;
      const payload = await ask(socket, 'load', 'settings');
      assert.equal(payload.flags.updatesTier, tier);
    });
  }

  it('reports flags.updatesTier even when the settings page is hidden', async function () {
    const saved = settings.showSettingsInAdminPage;
    settings.showSettingsInAdminPage = false;
    settings.updates.tier = 'off';
    try {
      const payload = await ask(socket, 'load', 'settings');
      assert.equal(payload.results, 'NOT_ALLOWED');
      assert.equal(payload.flags.updatesTier, 'off');
    } finally {
      settings.showSettingsInAdminPage = saved;
    }
  });

  it('help payload reports versionCheck: false when privacy.updateCheck is off', async function () {
    settings.privacy.updateCheck = false;
    const help = await ask(socket, 'help', 'reply:help');
    assert.equal(help.versionCheck, false);
    assert.equal(help.latestVersion, undefined);
  });

  it('help payload reports versionCheck: true by default', async function () {
    // getLatestVersion() kicks off the legacy fetch; keep it off the network.
    const savedServer = settings.updateServer;
    settings.updateServer = 'http://127.0.0.1:9';
    settings.privacy.updateCheck = true;
    try {
      const help = await ask(socket, 'help', 'reply:help');
      assert.equal(help.versionCheck, true);
    } finally {
      settings.updateServer = savedServer;
    }
  });
});
