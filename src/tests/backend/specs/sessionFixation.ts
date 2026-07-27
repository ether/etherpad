'use strict';

/**
 * Regression for GHSA-73h9-c5xp-gfg4 (SSO session fixation). Etherpad
 * establishes a pre-authentication express-session (e.g. an SSO plugin persists
 * OAuth state before redirecting to the IdP). If the session id is NOT rotated
 * when the session becomes authenticated, an attacker who planted / captured the
 * pre-auth cookie ends up owning the victim's authenticated session.
 *
 * webaccess must call req.session.regenerate() at the authentication boundary so
 * the id issued after login differs from the one held before it.
 */

const assert = require('assert').strict;
const common = require('../common');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import settings from '../../../node/utils/Settings';

const makeHook = (hookName: string, hookFn: Function) => ({
  hook_fn: hookFn,
  hook_fn_name: `sessfix/${hookName}`,
  hook_name: hookName,
  part: {plugin: 'sessfix'},
});

// Etherpad names the session cookie `${cookie.prefix}express_sid`.
const sessionCookieName = () => `${settings.cookie.prefix || ''}express_sid`;

// Pull a raw Set-Cookie value (e.g. the signed `s%3A<id>.<sig>` blob) by name.
const getSetCookie = (res: any, name: string): string | null => {
  const arr: string[] = res.headers['set-cookie'] || [];
  for (const c of arr) {
    if (c.startsWith(`${name}=`)) return c.slice(name.length + 1).split(';')[0];
  }
  return null;
};

describe(__filename, function () {
  this.timeout(30000);
  let agent: any;
  const backup: any = {};

  before(async function () { agent = await common.init(); });

  beforeEach(function () {
    backup.authenticate = plugins.hooks.authenticate;
    backup.requireAuthentication = settings.requireAuthentication;
    backup.requireAuthorization = settings.requireAuthorization;
    settings.requireAuthentication = true;
    settings.requireAuthorization = false;
    // An authn plugin that: (a) always touches the session so express-session
    // persists a cookie even pre-auth, and (b) only establishes req.session.user
    // when the login header is present (simulating a completed SSO callback).
    plugins.hooks.authenticate = [makeHook('authenticate', (hookName: string, ctx: any, cb: Function) => {
      ctx.req.session.sessfixTouched = true;
      if (ctx.req.headers['x-do-login'] === '1') {
        ctx.req.session.user = {username: 'victim'};
        return cb([true]);
      }
      return cb([false]);
    })];
  });

  afterEach(function () {
    plugins.hooks.authenticate = backup.authenticate;
    settings.requireAuthentication = backup.requireAuthentication;
    settings.requireAuthorization = backup.requireAuthorization;
  });

  it('rotates the session id when a pre-auth session authenticates', async function () {
    // Step 1 — anonymous request establishes a server-issued pre-auth session.
    const r1 = await agent.get('/').expect(401);
    const preSid = getSetCookie(r1, sessionCookieName());
    assert.ok(preSid, 'server issued a pre-auth session cookie');

    // Step 2 — same session cookie, now authenticate.
    const r2 = await agent.get('/')
        .set('Cookie', `${sessionCookieName()}=${preSid}`)
        .set('x-do-login', '1')
        .expect(200);
    const postSid = getSetCookie(r2, sessionCookieName());
    assert.ok(postSid,
        'the authentication response must rotate the session cookie (Set-Cookie present)');
    assert.notEqual(postSid, preSid,
        'session id must change at the authentication boundary (session fixation)');
  });

  it('rotates the session id on a privilege upgrade (non-admin -> admin)', async function () {
    // Reach Step 3 (authenticate) for an ALREADY-authenticated session by making
    // authorization deny unless an `x-authz` header is present.
    settings.requireAuthorization = true;
    const authzBackup = plugins.hooks.authorize;
    plugins.hooks.authorize = [makeHook('authorize', (hookName: string, ctx: any, cb: Function) =>
      cb([ctx.req.headers['x-authz'] === '1']))];
    plugins.hooks.authenticate = [makeHook('authenticate', (hookName: string, ctx: any, cb: Function) => {
      const login = ctx.req.headers['x-login'];
      if (login === 'user') { ctx.req.session.user = {username: 'u', is_admin: false}; return cb([true]); }
      if (login === 'admin') { ctx.req.session.user = {username: 'u', is_admin: true}; return cb([true]); }
      return cb([false]);
    })];
    try {
      // Log in as a non-admin (authorization granted via x-authz).
      const r1 = await agent.get('/').set('x-login', 'user').set('x-authz', '1').expect(200);
      const sid1 = getSetCookie(r1, sessionCookieName());
      assert.ok(sid1, 'non-admin login issued a session cookie');

      // Re-authenticate as admin carrying sid1 and NO x-authz, so Step 2
      // authorization denies and Step 3 runs the privilege upgrade.
      const r2 = await agent.get('/')
          .set('Cookie', `${sessionCookieName()}=${sid1}`)
          .set('x-login', 'admin')
          .expect(200);
      const sid2 = getSetCookie(r2, sessionCookieName());
      assert.ok(sid2, 'the privilege upgrade rotated the session cookie');
      assert.notEqual(sid2, sid1, 'session id must change on a privilege upgrade');
    } finally {
      plugins.hooks.authorize = authzBackup;
    }
  });

  it('preserves the authenticated user across the rotation', async function () {
    const r1 = await agent.get('/').expect(401);
    const preSid = getSetCookie(r1, sessionCookieName());
    const r2 = await agent.get('/')
        .set('Cookie', `${sessionCookieName()}=${preSid}`)
        .set('x-do-login', '1')
        .expect(200);
    const postSid = getSetCookie(r2, sessionCookieName());
    // The rotated session must still be authenticated: a follow-up request with
    // the NEW cookie (and no login header) is authorized, not bounced to 401.
    await agent.get('/').set('Cookie', `${sessionCookieName()}=${postSid}`).expect(200);
  });
});
