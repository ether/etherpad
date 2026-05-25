'use strict';

import {strict as assert} from 'assert';
import setCookieParser from 'set-cookie-parser';

const io = require('socket.io-client');
const common = require('../../common');
const settings = require('../../../../node/utils/Settings');
const authorManager = require('../../../../node/db/AuthorManager');

/**
 * Connects to the /settings admin namespace using cookie-based auth.
 * The /settings namespace reads is_admin from socket.conn.request.session,
 * which is populated by the express session middleware using the cookie passed
 * as a query parameter (socket.io-client on Node.js doesn't support cookies
 * natively).
 */
const adminSocket = async () => {
  // Ensure an admin user exists in settings.
  settings.users = settings.users || {};
  settings.users['test-admin'] = {password: 'test-admin-password', is_admin: true};

  // Fetch a page to establish an admin session and get the session cookie.
  // requireAuthentication must be true so the session gets the admin user.
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

  // Extract the session cookie to pass to the socket.
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

// adminSocket() depends on Etherpad's default plain-text password check for
// settings.users[name].password. Any authenticate-hook plugin that claims
// the request before the built-in basic-auth fallback can block this:
// the historical offender was ep_readonly_guest, whose authenticate hook
// sorts itself first and silently swaps req.session.user with a guest
// (#7795); ep_hash_auth-style plugins that expect hashed credentials
// would do the same. When that happens the basic-auth probe returns no
// admin session, /settings's connection handler returns without
// registering listeners (see src/node/hooks/express/adminsettings.ts:25),
// and every socket.emit() afterwards waits forever for a reply that
// nothing will ever send. The socket itself still connects when admin
// session is missing, so the probe has to run at the application layer:
// emit a known `/settings` event (`authorLoad`) and wait for the matching
// reply (`results:authorLoad`). If it doesn't arrive within the budget,
// skip — much cheaper than letting vitest's 120s per-test timeout absorb
// 7 stalled tests.
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
  // authorLoad is gated on the admin session being present (see
  // adminsettings.ts:25 — non-admin connections never register it) but
  // doesn't depend on any disk-resident settings file the way `load`
  // does, so it's a stable application-level liveness probe.
  const replied = new Promise<true>((res) => socket.once('results:authorLoad', () => res(true)));
  socket.emit('authorLoad', {
    pattern: '__anonymizeAuthorSocket-probe__', offset: 0, limit: 1,
    sortBy: 'name', ascending: true, includeErased: false,
  });
  const probed = await Promise.race([
    replied,
    new Promise<false>((res) => setTimeout(() => res(false), remaining)),
  ]);
  if (!probed) {
    socket.disconnect();
    return {ok: false, reason: `no \`results:authorLoad\` reply within ${budgetMs}ms (no admin handlers registered)`};
  }
  return {ok: true, socket};
};

describe(__filename, () => {
  let socket: any;
  let originalFlag: boolean;
  let savedUsers: any;
  let savedRequireAuthentication: boolean;
  let setupCompleted = false;
  // Set when the admin-socket probe fails: every it() in this suite checks
  // this flag and calls ctx.skip() to bail out (mocha's this.skip() in the
  // hook isn't available under vitest's beforeAll, so we drive the skip
  // from inside each test via the test-context parameter).
  let skipReason: string | null = null;

  before(async () => {
    await common.init();

    // Capture backups BEFORE any mutation so after() can restore cleanly
    // even if the probe times out (adminSocket mutates settings.users
    // and settings.requireAuthentication on its way in).
    settings.gdprAuthorErasure = settings.gdprAuthorErasure || {enabled: false};
    originalFlag = settings.gdprAuthorErasure.enabled;
    savedUsers = settings.users;
    savedRequireAuthentication = settings.requireAuthentication;
    settings.gdprAuthorErasure.enabled = true;
    setupCompleted = true;

    const probe = await adminSocketWithProbe(PROBE_BUDGET_MS);
    if (!probe.ok) {
      skipReason = probe.reason;
      console.warn(
          `[anonymizeAuthorSocket] admin socket probe failed (${probe.reason}); ` +
          'skipping suite — an authenticate-hook plugin (e.g. ep_readonly_guest, ' +
          'or an ep_hash_auth-style plugin requiring hashed credentials) is ' +
          'rejecting the test\'s plain-text admin credentials.');
      return;
    }
    socket = probe.socket;
  });

  after(() => {
    if (socket) socket.disconnect();
    // before() may have set skipReason before capturing backups (e.g.
    // a common.init() failure), so guard against writing undefined into
    // settings. Once setupCompleted flips true the backup variables are
    // safe to read.
    if (!setupCompleted) return;
    settings.gdprAuthorErasure.enabled = originalFlag;
    // savedUsers and settings.users point at the same object — restoring
    // the reference is a no-op against the in-place mutation. Delete the
    // injected test-admin key so subsequent tests see a clean users map.
    if (settings.users) delete settings.users['test-admin'];
    settings.users = savedUsers;
    settings.requireAuthentication = savedRequireAuthentication;
  });

  it('authorLoad returns paginated rows', async (ctx) => {
    if (skipReason) return ctx.skip();
    const tag = `sock-${Date.now()}`;
    await authorManager.createAuthorIfNotExistsFor(`m-${tag}`, `Sock ${tag}`);
    const res = await ask(socket, 'authorLoad',
        {pattern: tag, offset: 0, limit: 12, sortBy: 'name',
         ascending: true, includeErased: false},
        'results:authorLoad');
    assert.ok(res.total >= 1, JSON.stringify(res));
    assert.ok(res.results.some((r: any) => r.name === `Sock ${tag}`));
  });

  it('anonymizeAuthorPreview returns counters without flipping erased',
      async (ctx) => {
        if (skipReason) return ctx.skip();
        const tag = `prev-${Date.now()}`;
        const {authorID} = await authorManager.createAuthorIfNotExistsFor(
            `m-${tag}`, `Prev ${tag}`);
        const preview = await ask(socket, 'anonymizeAuthorPreview',
            {authorID}, 'results:anonymizeAuthorPreview');
        assert.equal(preview.authorID, authorID);
        assert.ok(preview.removedExternalMappings >= 1);
        const rec = await authorManager.getAuthor(authorID);
        assert.equal(rec.erased, undefined,
            'preview must not flip erased');
      });

  it('anonymizeAuthor commits when the flag is enabled', async (ctx) => {
    if (skipReason) return ctx.skip();
    const tag = `live-${Date.now()}`;
    const {authorID} = await authorManager.createAuthorIfNotExistsFor(
        `m-${tag}`, `Live ${tag}`);
    const res = await ask(socket, 'anonymizeAuthor',
        {authorID}, 'results:anonymizeAuthor');
    assert.equal(res.authorID, authorID);
    assert.ok(res.removedExternalMappings >= 1);
    const rec = await authorManager.getAuthor(authorID);
    assert.equal(rec.erased, true);
  });

  it('anonymizeAuthor returns {error: "disabled"} when flag is off',
      async (ctx) => {
        if (skipReason) return ctx.skip();
        settings.gdprAuthorErasure.enabled = false;
        try {
          const tag = `disabled-${Date.now()}`;
          const {authorID} = await authorManager.createAuthorIfNotExistsFor(
              `m-${tag}`, `Off ${tag}`);
          const res = await ask(socket, 'anonymizeAuthor',
              {authorID}, 'results:anonymizeAuthor');
          assert.equal(res.error, 'disabled');
          const rec = await authorManager.getAuthor(authorID);
          assert.notEqual(rec.erased, true,
              'record should not be erased when flag is off');
        } finally {
          settings.gdprAuthorErasure.enabled = true;
        }
      });

  it('anonymizeAuthorPreview returns {error: "disabled"} when flag is off',
      async (ctx) => {
        if (skipReason) return ctx.skip();
        // Per Qodo Compliance ID 6 ('new features behind a feature flag,
        // disabled by default') the preview event is also gated, not just
        // the live anonymizeAuthor. The page renders its disabled banner
        // off the socket reply when this fires.
        settings.gdprAuthorErasure.enabled = false;
        try {
          const tag = `prev-off-${Date.now()}`;
          const {authorID} = await authorManager.createAuthorIfNotExistsFor(
              `m-${tag}`, `PrevOff ${tag}`);
          const preview = await ask(socket, 'anonymizeAuthorPreview',
              {authorID}, 'results:anonymizeAuthorPreview');
          assert.equal(preview.error, 'disabled');
          assert.equal(preview.removedExternalMappings, undefined,
              'no counters should leak when the flag is off');
        } finally {
          settings.gdprAuthorErasure.enabled = true;
        }
      });

  it('authorLoad returns {error: "disabled"} when flag is off',
      async (ctx) => {
        if (skipReason) return ctx.skip();
        settings.gdprAuthorErasure.enabled = false;
        try {
          const res = await ask(socket, 'authorLoad',
              {pattern: '', offset: 0, limit: 12, sortBy: 'name',
               ascending: true, includeErased: false},
              'results:authorLoad');
          assert.equal(res.error, 'disabled');
          assert.deepEqual(res.results, []);
        } finally {
          settings.gdprAuthorErasure.enabled = true;
        }
      });

  it('handlers do not crash on payload-less emits',
      async (ctx) => {
        if (skipReason) return ctx.skip();
        // Pre-Qodo-fix the destructure `({authorID}: ...)` threw before
        // try/catch when client emitted with no payload. Both gated
        // handlers now accept `payload: any` and read defensively.
        const previewRes = await ask(socket, 'anonymizeAuthorPreview',
            undefined, 'results:anonymizeAuthorPreview');
        assert.ok(previewRes.error,
            `expected error, got ${JSON.stringify(previewRes)}`);
        const eraseRes = await ask(socket, 'anonymizeAuthor',
            undefined, 'results:anonymizeAuthor');
        assert.ok(eraseRes.error,
            `expected error, got ${JSON.stringify(eraseRes)}`);
      });
});
