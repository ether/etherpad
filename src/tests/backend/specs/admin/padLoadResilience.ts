'use strict';

// Regression test for issue #7935 ("Display issue of notes"): pads exist
// (visible on the welcome page, returned by the API `listAllPads`) but the
// admin "Manage pads" UI shows none.
//
// Root cause: the admin /settings `padLoad` handler hydrates every pad via
// `padManager.getPad()` to build the listing (the default `lastEdited` sort
// forces a full scan). `findKeys('pad:*', '*:*:*')` returns *every* key under
// the `pad:` prefix, including legacy / foreign / migration-corrupted records
// — e.g. a value stored as a JSON *string* rather than a pad object, which is
// exactly what a botched dirty.db → PostgreSQL migration produces. Loading
// such a record makes `Pad.init` throw `Cannot use 'in' operator to search
// for 'pool' in <string>`. Before the fix that single rejection took out the
// whole handler: no `results:padLoad` was ever emitted (the SPA showed an
// empty "No results" state forever) and the unhandled rejection could exit
// the server. The handler now skips unreadable pads (surfacing them with
// zeroed metadata so an admin can still delete them) and always emits a
// terminal reply.

import {strict as assert} from 'assert';
import setCookieParser from 'set-cookie-parser';

const io = require('socket.io-client');
const common = require('../../common');
const settings = require('../../../../node/utils/Settings');
const padManager = require('../../../../node/db/PadManager');
const db = require('../../../../node/db/DB');

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
    const onErr = (err: any) => { socket.off('connect', onConn); reject(err); };
    const onConn = () => { socket.off('connect_error', onErr); resolve(); };
    socket.once('connect', onConn);
    socket.once('connect_error', onErr);
  });
  return socket;
};

const ask = (socket: any, evt: string, payload: any, replyEvt: string, timeoutMs = 10000) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
          () => reject(new Error(`no \`${replyEvt}\` reply within ${timeoutMs}ms`)), timeoutMs);
      socket.once(replyEvt, (data: any) => { clearTimeout(timer); resolve(data); });
      socket.emit(evt, payload);
    });

describe(__filename, function () {
  let socket: any;
  let savedUsers: any;
  let savedRequireAuthentication: boolean;
  let setupCompleted = false;
  const tag = `padLoadResilience-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const goodId = `${tag}-good`;
  const corruptId = `${tag}-corrupt`;

  before(async function () {
    this.timeout(120000);
    await common.init();

    savedUsers = settings.users;
    savedRequireAuthentication = settings.requireAuthentication;
    setupCompleted = true;

    try {
      socket = await adminSocket();
    } catch (err: any) {
      console.warn(
          `[padLoadResilience] admin socket connect failed (${err && err.message}); ` +
          "skipping suite — likely an authenticate-hook plugin rejecting the test's " +
          'admin credentials.');
      this.skip();
      return;
    }

    // A normal, readable pad — this is what must still show up.
    await padManager.getPad(goodId, 'good content\n');

    // A pad that enters the pad-name index normally, then has its stored
    // value clobbered into a non-object (a JSON string) to mimic a
    // migration-corrupted / foreign `pad:*` record. Evicting it from the
    // in-memory cache forces the next getPad() to re-read the bad value.
    await padManager.getPad(corruptId, 'temp\n');
    await db.set(`pad:${corruptId}`, 'corrupt-non-object-value');
    padManager.unloadPad(corruptId);

    // Sanity-check that the setup actually reproduces the failing read; if
    // this stops throwing the test is no longer exercising the bug.
    await assert.rejects(padManager.getPad(corruptId),
        'expected the corrupted pad record to make getPad throw');
  });

  after(async function () {
    if (socket) socket.disconnect();
    if (!setupCompleted) return;
    if (settings.users) delete settings.users['test-admin'];
    settings.users = savedUsers;
    settings.requireAuthentication = savedRequireAuthentication;
    for (const id of [goodId, corruptId]) {
      try { await db.remove(`pad:${id}`); } catch { /* ignore */ }
      try { await db.remove(`pad:${id}:revs:0`); } catch { /* ignore */ }
      try { padManager.unloadPad(id); } catch { /* ignore */ }
    }
  });

  it('a single corrupt pad does not hide every other pad (issue #7935)', async function () {
    this.timeout(30000);
    // The default query the SPA sends on initial load: lastEdited sort forces
    // the full-scan hydration path that touches every pad — including the
    // corrupt one.
    const res = await ask(socket, 'padLoad', {
      pattern: tag, offset: 0, limit: 12,
      sortBy: 'lastEdited', ascending: false, filter: 'all',
    }, 'results:padLoad');

    const names = res.results.map((r: any) => r.padName);
    assert.ok(names.includes(goodId),
        `the readable pad must still be listed; got ${JSON.stringify(names)}`);
    // The bad pad is surfaced (zeroed metadata) rather than silently dropped,
    // so an admin can see and delete it.
    assert.ok(names.includes(corruptId),
        `the corrupt pad should surface for deletion; got ${JSON.stringify(names)}`);
    assert.equal(res.total, 2, `expected total=2, got ${JSON.stringify(res)}`);
  });

  it('still replies on the fast path (padName sort) with a corrupt pad present', async function () {
    this.timeout(30000);
    const res = await ask(socket, 'padLoad', {
      pattern: tag, offset: 0, limit: 12,
      sortBy: 'padName', ascending: true, filter: 'all',
    }, 'results:padLoad');
    const names = res.results.map((r: any) => r.padName);
    assert.ok(names.includes(goodId), `got ${JSON.stringify(names)}`);
    assert.ok(names.includes(corruptId), `got ${JSON.stringify(names)}`);
  });
});
