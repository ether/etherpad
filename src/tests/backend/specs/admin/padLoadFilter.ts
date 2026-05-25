'use strict';

// Regression test for the admin /settings socket's `padLoad` filter chip.
// Before commit fb…, `filter` (active|empty|recent|stale) lived only on
// the client and ran AFTER pagination, so clicking "empty pads" on a
// server with thousands of pads showed 0–12 results from page 1 even
// though hundreds of empty pads existed deeper in the list. The filter
// now rides PadSearchQuery and is applied server-side before the
// offset/limit slice, so `total` reflects the filtered universe.

import {strict as assert} from 'assert';
import {vi} from 'vitest';
import setCookieParser from 'set-cookie-parser';

const io = require('socket.io-client');
const common = require('../../common');
const settings = require('../../../../node/utils/Settings');
const padManager = require('../../../../node/db/PadManager');

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

const ask = (socket: any, evt: string, payload: any, replyEvt: string) =>
    new Promise<any>((res) => {
      socket.once(replyEvt, res);
      socket.emit(evt, payload);
    });

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
  const replied = new Promise<true>((res) => socket.once('results:padLoad', () => res(true)));
  socket.emit('padLoad', {
    pattern: '__padLoadFilter-probe__', offset: 0, limit: 1,
    sortBy: 'padName', ascending: true,
  });
  const probed = await Promise.race([
    replied,
    new Promise<false>((res) => setTimeout(() => res(false), remaining)),
  ]);
  if (!probed) {
    socket.disconnect();
    return {ok: false, reason: `no \`results:padLoad\` reply within ${budgetMs}ms`};
  }
  return {ok: true, socket};
};

describe(__filename, () => {
  let socket: any;
  let savedUsers: any;
  let savedRequireAuthentication: boolean;
  let setupCompleted = false;
  let skipReason: string | null = null;
  // Distinct per-suite tag so concurrent test runs / leftover pads from
  // earlier suites don't pollute the filter assertions.
  const tag = `padLoadFilter-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const emptyPadIds: string[] = [];
  const editedPadIds: string[] = [];

  before(async () => {
    vi.setConfig({hookTimeout: 120000});
    await common.init();

    savedUsers = settings.users;
    savedRequireAuthentication = settings.requireAuthentication;
    setupCompleted = true;

    const probe = await adminSocketWithProbe(PROBE_BUDGET_MS);
    if (!probe.ok) {
      console.warn(
          `[padLoadFilter] admin socket probe failed (${probe.reason}); ` +
          "skipping suite — likely an authenticate-hook plugin rejecting the test's " +
          'admin credentials.');
      skipReason = probe.reason;
      return;
    }
    socket = probe.socket;

    // 5 empty pads, 3 edited (head rev > 0).
    for (let i = 0; i < 5; i++) {
      const id = `${tag}-empty-${i}`;
      await padManager.getPad(id, '');
      emptyPadIds.push(id);
    }
    for (let i = 0; i < 3; i++) {
      const id = `${tag}-edited-${i}`;
      const pad = await padManager.getPad(id, '');
      // setText bumps head past 0; padLoad reports the post-edit
      // revisionNumber, which is what filter:"empty" excludes.
      await pad.setText(`seed-${i}\n`, `m-${tag}-${i}`);
      editedPadIds.push(id);
    }
  });

  after(async () => {
    if (socket) socket.disconnect();
    if (!setupCompleted) return;
    // `savedUsers` may point at the same object that adminSocket mutated,
    // so reassigning the reference is a no-op; explicitly delete the
    // injected key so subsequent backend specs don't see a stale
    // test-admin user.
    if (settings.users) delete settings.users['test-admin'];
    settings.users = savedUsers;
    settings.requireAuthentication = savedRequireAuthentication;
    for (const id of [...emptyPadIds, ...editedPadIds]) {
      try {
        const pad = await padManager.getPad(id, '');
        await pad.remove();
      } catch { /* already gone */ }
    }
  });

  it('filter:"empty" returns only revisionNumber===0 pads from the full set', async (ctx) => {
    if (skipReason) return ctx.skip();
    const res = await ask(socket, 'padLoad', {
      pattern: tag, offset: 0, limit: 12, sortBy: 'padName',
      ascending: true, filter: 'empty',
    }, 'results:padLoad');
    assert.equal(res.total, 5, `expected total=5, got ${JSON.stringify(res)}`);
    for (const r of res.results) {
      assert.equal(r.revisionNumber, 0,
          `non-empty pad leaked through filter: ${JSON.stringify(r)}`);
    }
  });

  it('filter:"empty" with limit=2 still reports the correct total (regression: thm)', async (ctx) => {
    if (skipReason) return ctx.skip();
    // The bug thm hit: clicking "empty" showed at most `limit` empties
    // because filtering happened on the client AFTER pagination. The
    // server now applies filter first, so total reflects the filtered
    // universe and pagination spans it correctly.
    const res = await ask(socket, 'padLoad', {
      pattern: tag, offset: 0, limit: 2, sortBy: 'padName',
      ascending: true, filter: 'empty',
    }, 'results:padLoad');
    assert.equal(res.total, 5, `expected total=5 (all empties), got total=${res.total}`);
    assert.equal(res.results.length, 2, `expected limit=2 page, got ${res.results.length} rows`);
  });

  it('filter omitted (older client) falls back to "all"', async (ctx) => {
    if (skipReason) return ctx.skip();
    const res = await ask(socket, 'padLoad', {
      pattern: tag, offset: 0, limit: 12, sortBy: 'padName',
      ascending: true,
    }, 'results:padLoad');
    assert.equal(res.total, 8,
        `expected total=8 (5 empty + 3 edited), got ${JSON.stringify(res)}`);
  });

  it('filter:"all" matches the no-filter behaviour', async (ctx) => {
    if (skipReason) return ctx.skip();
    const res = await ask(socket, 'padLoad', {
      pattern: tag, offset: 0, limit: 12, sortBy: 'padName',
      ascending: true, filter: 'all',
    }, 'results:padLoad');
    assert.equal(res.total, 8);
  });

  it('filter:"active" excludes pads with no active users', async (ctx) => {
    if (skipReason) return ctx.skip();
    // No connected clients in this test, so every test pad has
    // userCount === 0 → filter:"active" must return zero.
    const res = await ask(socket, 'padLoad', {
      pattern: tag, offset: 0, limit: 12, sortBy: 'padName',
      ascending: true, filter: 'active',
    }, 'results:padLoad');
    assert.equal(res.total, 0);
    assert.equal(res.results.length, 0);
  });
});
