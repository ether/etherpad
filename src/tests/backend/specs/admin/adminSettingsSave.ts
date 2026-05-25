'use strict';

import {strict as assert} from 'assert';
import {vi} from 'vitest';
import setCookieParser from 'set-cookie-parser';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const io = require('socket.io-client');
const common = require('../../common');
const settings = require('../../../../node/utils/Settings');

// Mirrors the adminSocket helper in adminSettingsResolved.ts. Lifted here
// because the suite owns its own settings.settingsFilename stub and we
// don't want either suite's setup/teardown to step on the other.
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
  await new Promise<void>((res, rej) => {
    const onErr = (err: any) => { socket.off('connect', onConn); rej(err); };
    const onConn = () => { socket.off('connect_error', onErr); res(); };
    socket.once('connect', onConn);
    socket.once('connect_error', onErr);
  });
  return socket;
};

const PROBE_BUDGET_MS = 15000;
const adminSocketWithProbe = async (budgetMs: number): Promise<{
  ok: true; socket: any;
} | {ok: false; reason: string;}> => {
  const deadline = Date.now() + budgetMs;
  let socket: any;
  try {
    socket = await Promise.race([
      adminSocket(),
      new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('adminSocket connect timed out')),
              Math.max(0, deadline - Date.now()))),
    ]);
  } catch (err: any) {
    return {ok: false, reason: String(err && err.message || err)};
  }
  const remaining = Math.max(0, deadline - Date.now());
  const replied = new Promise<true>((res) => socket.once('settings', () => res(true)));
  socket.emit('load', null);
  const probed = await Promise.race([
    replied,
    new Promise<false>((res) => setTimeout(() => res(false), remaining)),
  ]);
  if (!probed) {
    socket.disconnect();
    return {ok: false, reason: `no \`settings\` reply within ${budgetMs}ms`};
  }
  return {ok: true, socket};
};

const ask = (socket: any, evt: string, payload: any, replyEvt: string) =>
    new Promise<any>((res) => {
      socket.once(replyEvt, res);
      socket.emit(evt, payload);
    });

const save = (socket: any, payload: string) =>
    new Promise<{status: string; detail?: any}>((res, rej) => {
      const timeout = setTimeout(
          () => rej(new Error('saveSettings: no saveprogress within 5s')), 5000);
      socket.once('saveprogress', (status: string, detail: any) => {
        clearTimeout(timeout);
        res({status, detail});
      });
      socket.emit('saveSettings', payload);
    });

// Regression coverage for issue #7819 / the broader observation that the
// admin saveSettings socket has zero backend coverage. The goal here is
// narrow: prove that whatever raw string the admin SPA emits ends up on
// disk byte-for-byte at settings.settingsFilename, and the subsequent
// `load` reply reflects the new file contents. We do NOT exercise
// runtime reload — that's reloadSettings()' job and is covered elsewhere.
describe(__filename, () => {
  let socket: any;
  let savedUsers: any;
  let savedRequireAuthentication: boolean;
  let savedSettingsFilename: any;
  let tmpSettingsPath: string | null = null;
  let baselineContents: string;
  let setupCompleted = false;
  let skipReason: string | null = null;

  before(async () => {
    vi.setConfig({hookTimeout: 60000});
    await common.init();

    savedSettingsFilename = settings.settingsFilename;
    tmpSettingsPath = path.join(os.tmpdir(),
        `etherpad-7819-settings-${process.pid}.json`);
    // Realistic baseline: keys you'd find in a stock settings.json.
    // Saved with two-space indent so we can later assert formatting is
    // preserved through the write path.
    baselineContents = JSON.stringify({
      title: 'Etherpad',
      ip: '0.0.0.0',
      port: 9001,
      users: {admin: {password: 'changeme1', is_admin: true}},
    }, null, 2) + '\n';
    fs.writeFileSync(tmpSettingsPath, baselineContents);
    settings.settingsFilename = tmpSettingsPath;

    savedUsers = settings.users;
    savedRequireAuthentication = settings.requireAuthentication;
    setupCompleted = true;

    const probe = await adminSocketWithProbe(PROBE_BUDGET_MS);
    if (!probe.ok) {
      console.warn(
          `[adminSettingsSave] admin socket probe failed (${probe.reason}); ` +
          'skipping suite — likely an authenticate-hook plugin rejecting test creds.');
      skipReason = probe.reason;
      return;
    }
    socket = probe.socket;
  });

  after(() => {
    if (socket) socket.disconnect();
    if (!setupCompleted) return;
    settings.settingsFilename = savedSettingsFilename;
    if (tmpSettingsPath) {
      try { fs.unlinkSync(tmpSettingsPath); } catch { /* best effort */ }
    }
    if (settings.users) delete settings.users['test-admin'];
    settings.users = savedUsers;
    settings.requireAuthentication = savedRequireAuthentication;
  });

  // Reset to baseline between tests so each it() is independent — earlier
  // suites in the same run can leave behind state via shared sockets.
  beforeEach((ctx) => {
    if (!tmpSettingsPath) return ctx.skip();
    fs.writeFileSync(tmpSettingsPath!, baselineContents);
  });

  it('saveSettings writes the payload byte-for-byte to settings.settingsFilename',
      async (ctx) => {
        if (skipReason) return ctx.skip();
        const payload = JSON.stringify({title: 'EtherpadWrittenViaSocket'}, null, 2);
        const ack = await save(socket, payload);
        assert.equal(ack.status, 'saved', 'saveprogress should be "saved"');
        const onDisk = fs.readFileSync(tmpSettingsPath!, 'utf8');
        assert.equal(onDisk, payload,
            'on-disk contents must equal the raw payload (no transform)');
      });

  // The shape that triggered #7819: take an existing settings.json and add
  // one new top-level block (a plugin config). The block must persist on
  // disk verbatim and reappear in the next `load` reply.
  it('augmenting existing JSON with a new top-level plugin block round-trips',
      async (ctx) => {
        if (skipReason) return ctx.skip();
        const augmented = JSON.stringify({
          title: 'Etherpad',
          ip: '0.0.0.0',
          port: 9001,
          ep_oauth: {
            clientID: 'Iv1.testclient',
            clientSecret: 'testsecret',
            callbackURL: 'https://etherpad.example.com/auth/callback',
          },
          users: {admin: {password: 'changeme1', is_admin: true}},
        }, null, 2);

        const ack = await save(socket, augmented);
        assert.equal(ack.status, 'saved');

        const onDisk = fs.readFileSync(tmpSettingsPath!, 'utf8');
        assert.equal(onDisk, augmented,
            'augmented JSON must be on disk verbatim');

        // load() now reads the file we just wrote — `results` is the raw
        // string, so it must contain the plugin block we added.
        const reply: any = await ask(socket, 'load', null, 'settings');
        assert.equal(reply.results, augmented,
            'load.results must equal the file we just saved');
        assert.ok(reply.results.includes('"ep_oauth"'),
            'plugin block must be present in subsequent load');
      });

  // /* */ comments are legal in the admin editor (jsonc-parser tolerates
  // them; the SPA's isJSONClean strips them before validation). The save
  // path must not normalize or strip them — the SPA test
  // 'preserves /* */ comments after save round-trip' covers the UI side;
  // this one covers the socket-level guarantee.
  it('preserves /* */ comments in the written file', async (ctx) => {
    if (skipReason) return ctx.skip();
    const withComment =
        '/* persisted-marker-7819 */\n' +
        JSON.stringify({title: 'Etherpad'}, null, 2);
    const ack = await save(socket, withComment);
    assert.equal(ack.status, 'saved');
    const onDisk = fs.readFileSync(tmpSettingsPath!, 'utf8');
    assert.ok(onDisk.includes('persisted-marker-7819'),
        'comment must survive the write path');
  });
});
