import {strict as assert} from 'assert';
import setCookieParser from 'set-cookie-parser';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {io} from 'socket.io-client';
import * as common from '../../common.js';
import settings from '../../../../node/utils/Settings.js';

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

// Probe modeled on anonymizeAuthorSocket.ts — when an authenticate-hook
// plugin (e.g. ep_hash_auth) rejects plain-text test creds, the /settings
// connection handler never registers listeners and every emit hangs.
// `load` is the simplest event with a matching reply on this namespace.
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

describe(__filename, () => {
  let socket: any;
  let savedUsers: any;
  let savedRequireAuthentication: boolean;
  let savedDbPwd: any;
  let savedTrustProxy: any;
  let savedSessionKey: any;
  let savedShow: any;
  let savedSettingsFilename: any;
  let tmpSettingsPath: string | null = null;
  let setupCompleted = false;
  let skipReason: string | null = null;

  before(async () => {
    await common.init();

    // The load handler bails with logger.error + early return if the
    // file is missing, so make sure something is on disk for it to read.
    savedSettingsFilename = settings.settingsFilename;
    tmpSettingsPath = path.join(os.tmpdir(),
        `etherpad-7803-settings-${process.pid}.json`);
    fs.writeFileSync(tmpSettingsPath,
        '{\n  "_comment": "stub settings.json for adminSettingsResolved.ts"\n}\n');
    settings.settingsFilename = tmpSettingsPath;

    savedUsers = settings.users;
    savedRequireAuthentication = settings.requireAuthentication;
    settings.dbSettings = settings.dbSettings || {};
    savedDbPwd = settings.dbSettings.password;
    savedTrustProxy = settings.trustProxy;
    savedSessionKey = settings.sessionKey;
    savedShow = settings.showSettingsInAdminPage;
    // Mutate the in-memory module so we can prove `resolved` reflects
    // the runtime, not the file on disk.
    settings.dbSettings.password = 'live-db-password';
    settings.trustProxy = true;
    settings.sessionKey = 'live-session-key';
    setupCompleted = true;

    const probe = await adminSocketWithProbe(PROBE_BUDGET_MS);
    if (!probe.ok) {
      console.warn(
          `[adminSettingsResolved] admin socket probe failed (${probe.reason}); ` +
          'skipping suite — likely an authenticate-hook plugin rejecting test creds.');
      skipReason = probe.reason;
      return;
    }
    socket = probe.socket;
  });

  after(() => {
    if (socket) socket.disconnect();
    if (!setupCompleted) return;
    if (savedDbPwd === undefined) delete settings.dbSettings.password;
    else settings.dbSettings.password = savedDbPwd;
    settings.trustProxy = savedTrustProxy;
    settings.sessionKey = savedSessionKey;
    settings.showSettingsInAdminPage = savedShow;
    settings.settingsFilename = savedSettingsFilename;
    if (tmpSettingsPath) {
      try { fs.unlinkSync(tmpSettingsPath); } catch { /* best effort */ }
    }
    if (settings.users) delete settings.users['test-admin'];
    settings.users = savedUsers;
    settings.requireAuthentication = savedRequireAuthentication;
  });

  it('emits {results, resolved, flags}', async (ctx) => {
    if (skipReason) return ctx.skip();
    const reply: any = await ask(socket, 'load', null, 'settings');
    assert.ok(reply, 'reply present');
    assert.equal(typeof reply.results, 'string', 'raw file string');
    assert.equal(typeof reply.resolved, 'object', 'resolved object');
    assert.ok(reply.flags, 'flags present');
  });

  it('resolved reflects live in-memory values, not the file on disk', async (ctx) => {
    if (skipReason) return ctx.skip();
    const reply: any = await ask(socket, 'load', null, 'settings');
    assert.equal(reply.resolved.trustProxy, true,
        'resolved should show the in-memory trustProxy');
  });

  it('resolved redacts secrets', async (ctx) => {
    if (skipReason) return ctx.skip();
    const reply: any = await ask(socket, 'load', null, 'settings');
    assert.equal(reply.resolved.dbSettings.password, '[REDACTED]');
    assert.equal(reply.resolved.sessionKey, '[REDACTED]');
  });

  it('resolved is omitted when showSettingsInAdminPage is false', async (ctx) => {
    if (skipReason) return ctx.skip();
    settings.showSettingsInAdminPage = false;
    try {
      const reply: any = await ask(socket, 'load', null, 'settings');
      assert.equal(reply.results, 'NOT_ALLOWED');
      assert.equal(reply.resolved, undefined);
    } finally {
      settings.showSettingsInAdminPage = savedShow;
    }
  });
});
