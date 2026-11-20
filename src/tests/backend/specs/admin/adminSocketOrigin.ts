'use strict';

// Origin checks on the admin socket.io namespaces. A page on a sibling
// subdomain is same-site, so a SameSite=Lax session cookie is still sent with
// its WebSocket handshake; the server must reject handshakes opened by pages
// that are not Etherpad, without depending on the Host header (reverse
// proxies may rewrite it).

import {strict as assert} from 'assert';
import setCookieParser from 'set-cookie-parser';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  adminSocketToken, checkSocketOrigin, isValidAdminSocketToken, normalizeOrigin,
  setAdminSocketTokenSecrets,
} from '../../../../node/utils/socketOrigin';
import {getIo, originCheckMiddleware} from '../../../../node/hooks/express/socketio';

const io = require('socket.io-client');
const common = require('../../common');
const settings = require('../../../../node/utils/Settings');

const adminCookieHeader = async (): Promise<string> => {
  settings.users = settings.users || {};
  settings.users['test-admin'] = {password: 'test-admin-password', is_admin: true};
  const savedRequireAuthentication = settings.requireAuthentication;
  settings.requireAuthentication = true;
  let res: any;
  try {
    res = await (common.agent as any).get('/admin/').auth('test-admin', 'test-admin-password');
  } finally {
    settings.requireAuthentication = savedRequireAuthentication;
  }
  const resCookies = setCookieParser.parse(res, {map: true});
  return Object.entries(resCookies)
      .map(([name, cookie]: [string, any]) => `${name}=${encodeURIComponent(cookie.value)}`)
      .join('; ');
};

type Outcome = {event: 'connect', socket: any} | {event: 'connect_error', message: string};

type SocketOpts = {
  origin?: string | null,
  secFetchSite?: string,
  token?: string,
};

const openAdminSocket = (
    ns: string, cookie: string, transport: string, opts: SocketOpts = {}): Promise<Outcome> => {
  const extraHeaders: Record<string, string> = {};
  if (opts.origin != null) extraHeaders.Origin = opts.origin;
  if (opts.secFetchSite != null) extraHeaders['Sec-Fetch-Site'] = opts.secFetchSite;
  const socket = io(`${common.baseUrl}${ns}`, {
    forceNew: true,
    reconnection: false,
    transports: [transport],
    query: {cookie},
    extraHeaders,
    auth: opts.token == null ? {} : {adminSocketToken: opts.token},
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`no connect/connect_error on ${ns} within 8s`));
    }, 8000);
    socket.once('connect', () => { clearTimeout(timeout); resolve({event: 'connect', socket}); });
    socket.once('connect_error', (err: any) => {
      clearTimeout(timeout);
      socket.close();
      resolve({event: 'connect_error', message: String(err && err.message)});
    });
  });
};

describe(__filename, function () {
  this.timeout(30000);

  describe('checkSocketOrigin()', function () {
    const req = (headers: Record<string, string>) => ({headers});

    it('accepts a Host-rewriting proxy when the browser reports same-origin', function () {
      // nginx `proxy_set_header Host $proxy_host`: Etherpad sees its upstream
      // address as Host and no X-Forwarded-Host; trustProxy/publicURL unset.
      const d = checkSocketOrigin(req({
        'host': '127.0.0.1:9001',
        'origin': 'https://pad.example.com',
        'sec-fetch-site': 'same-origin',
      }), {});
      assert.equal(d.allowed, true, d.reason);
    });

    it('accepts a Host-rewriting proxy without Fetch Metadata when the token is valid',
        function () {
          const r = req({host: '127.0.0.1:9001', origin: 'http://pad.example.lan'});
          assert.equal(checkSocketOrigin(r, {tokenValid: true}).allowed, true);
          assert.equal(checkSocketOrigin(r, {tokenValid: false}).allowed, false);
        });

    it('accepts Sec-Fetch-Site "none"', function () {
      assert.equal(checkSocketOrigin(
          req({'host': 'pad.example.com', 'sec-fetch-site': 'none'}), {}).allowed, true);
    });

    it('rejects a same-site sibling subdomain', function () {
      assert.equal(checkSocketOrigin(req({
        'host': 'pad.example.com',
        'origin': 'https://other.example.com',
        'sec-fetch-site': 'same-site',
      }), {}).allowed, false);
      // Without Fetch Metadata and without a token.
      assert.equal(checkSocketOrigin(
          req({host: 'pad.example.com', origin: 'https://other.example.com'}), {}).allowed,
          false);
    });

    it('rejects cross-site, even with a valid token or a matching Host', function () {
      assert.equal(checkSocketOrigin(req({
        'host': 'pad.example.com',
        'origin': 'https://other.example.org',
        'sec-fetch-site': 'cross-site',
      }), {tokenValid: true}).allowed, false);
      assert.equal(checkSocketOrigin(req({
        'host': 'pad.example.com',
        'origin': 'https://pad.example.com',
        'sec-fetch-site': 'cross-site',
      }), {}).allowed, false);
    });

    it('accepts a request without any of these headers (CLI / non-browser)', function () {
      assert.equal(checkSocketOrigin(req({host: 'pad.example.com'}), {}).allowed, true);
      assert.equal(checkSocketOrigin(req({}), {}).allowed, true);
    });

    it('falls back to the Host header without Fetch Metadata or token', function () {
      assert.equal(checkSocketOrigin(
          req({host: 'pad.example.com', origin: 'https://pad.example.com'}), {}).allowed, true);
      assert.equal(checkSocketOrigin(
          req({host: 'localhost:9001', origin: 'http://localhost:9001'}), {}).allowed, true);
      // Default port in Host normalizes to the Origin's implicit port.
      assert.equal(checkSocketOrigin(
          req({host: 'pad.example.com:443', origin: 'https://pad.example.com'}), {}).allowed, true);
      assert.equal(checkSocketOrigin(
          req({host: 'PAD.example.com', origin: 'https://pad.example.com'}), {}).allowed, true);
      assert.equal(checkSocketOrigin(
          req({host: '[::1]:9001', origin: 'http://[::1]:9001'}), {}).allowed, true);
      assert.equal(checkSocketOrigin(
          req({host: 'localhost:9001', origin: 'http://localhost:5173'}), {}).allowed, false);
      assert.equal(checkSocketOrigin(
          req({host: 'other.example.com/x', origin: 'https://other.example.com'}), {}).allowed,
          false);
    });

    it('rejects null, malformed and non-http Origins', function () {
      for (const origin of ['null', 'garbage', 'file://', 'chrome-extension://abc',
        'https://pad.example.com@other.example.com', 'https://pad.example.com/path']) {
        assert.equal(checkSocketOrigin(req({host: 'pad.example.com', origin}), {}).allowed,
            false, origin);
      }
    });

    it('honours X-Forwarded-Host only when trustProxy is enabled', function () {
      const r = req({
        'host': '127.0.0.1:9001',
        'x-forwarded-host': 'pad.example.com, internal.lan',
        'origin': 'https://pad.example.com',
      });
      assert.equal(checkSocketOrigin(r, {trustProxy: false}).allowed, false);
      assert.equal(checkSocketOrigin(r, {trustProxy: true}).allowed, true);
      assert.equal(checkSocketOrigin(
          {headers: {...r.headers, origin: 'https://other.example.com'}},
          {trustProxy: true}).allowed, false);
    });

    it('accepts the publicURL origin and socketIo.allowedOrigins entries', function () {
      const r = req({host: '127.0.0.1:9001', origin: 'https://pad.example.com'});
      assert.equal(checkSocketOrigin(r, {publicURL: 'https://pad.example.com/'}).allowed, true);
      assert.equal(checkSocketOrigin(r, {allowedOrigins: ['https://pad.example.com']}).allowed,
          true);
      assert.equal(checkSocketOrigin(
          r, {allowedOrigins: 'https://other.example.com, https://pad.example.com'}).allowed,
          true);
      assert.equal(checkSocketOrigin(r, {allowedOrigins: ['https://other.example.com']}).allowed,
          false);
      assert.equal(checkSocketOrigin(r, {allowedOrigins: ''}).allowed, false);
      assert.equal(checkSocketOrigin(r, {allowedOrigins: null}).allowed, false);
      // An explicitly allowed origin wins over Sec-Fetch-Site.
      assert.equal(checkSocketOrigin(
          {headers: {...r.headers, 'sec-fetch-site': 'same-site'}},
          {allowedOrigins: ['https://pad.example.com']}).allowed, true);
    });

    it('normalizeOrigin()', function () {
      assert.equal(normalizeOrigin('HTTPS://Pad.Example.com:443'), 'https://pad.example.com');
      assert.equal(normalizeOrigin('null'), null);
      assert.equal(normalizeOrigin(undefined), null);
    });

    it('admin socket tokens are bound to the session id', function () {
      const t = adminSocketToken('session-a');
      assert.equal(isValidAdminSocketToken('session-a', t), true);
      assert.equal(isValidAdminSocketToken('session-b', t), false);
      assert.equal(isValidAdminSocketToken('session-a', `${t}x`), false);
      assert.equal(isValidAdminSocketToken('session-a', ''), false);
      assert.equal(isValidAdminSocketToken('session-a', undefined), false);
      assert.equal(isValidAdminSocketToken(undefined, t), false);
    });

    it('admin socket tokens are keyed with the shared session secrets', function () {
      // Instances on the same database share SecretRotator's secrets, so a
      // token issued by one must validate on another, including across a
      // rotation (new secret first, previous ones still listed).
      const prev = setAdminSocketTokenSecrets(() => ['secret-a']);
      try {
        const t = adminSocketToken('session-a');
        setAdminSocketTokenSecrets(() => ['secret-a']);
        assert.equal(isValidAdminSocketToken('session-a', t), true, 'other instance');
        setAdminSocketTokenSecrets(() => ['secret-b', 'secret-a']);
        assert.equal(isValidAdminSocketToken('session-a', t), true, 'after rotation');
        assert.notEqual(adminSocketToken('session-a'), t);
        setAdminSocketTokenSecrets(() => ['secret-c']);
        assert.equal(isValidAdminSocketToken('session-a', t), false, 'unrelated secret');
      } finally {
        setAdminSocketTokenSecrets(prev);
      }
    });
  });

  describe('admin namespaces over socket.io', function () {
    let cookie: string;
    let token: string;
    let sameOrigin: string;
    let siblingOrigin: string;
    // What the browser sees in front of a Host-rewriting proxy.
    const proxiedOrigin = 'https://pad.example.com';
    let backupAllowed: any;

    before(async function () {
      await common.init();
      cookie = await adminCookieHeader();
      const res = await common.agent.get('/admin-auth/socket-token')
          .set('Cookie', cookie).expect(200);
      token = res.body.token;
      assert.equal(typeof token, 'string');
      const base = new URL(common.baseUrl);
      sameOrigin = base.origin;
      // Same site as the server (localhost), different origin.
      siblingOrigin = `http://sibling.localhost:${base.port}`;
      backupAllowed = settings.socketIo.allowedOrigins;
    });

    afterEach(function () {
      settings.socketIo.allowedOrigins = backupAllowed;
    });

    describe('GET /admin-auth/socket-token', function () {
      it('requires an admin session', async function () {
        await common.agent.get('/admin-auth/socket-token').expect(401);
      });

      it('is not cacheable and sends no CORS headers', async function () {
        const res = await common.agent.get('/admin-auth/socket-token')
            .set('Cookie', cookie)
            .set('Origin', siblingOrigin)
            .expect(200);
        assert.match(String(res.headers['cache-control']), /no-store/);
        assert.equal(res.headers['access-control-allow-origin'], undefined);
        assert.equal(res.headers['access-control-allow-credentials'], undefined);
      });
    });

    const expectRejected = async (p: Promise<Outcome>) => {
      const r = await p;
      if (r.event === 'connect') r.socket.close();
      assert.equal(r.event, 'connect_error');
      assert.match((r as any).message, /origin not allowed/);
    };
    const expectAccepted = async (p: Promise<Outcome>) => {
      const r = await p;
      assert.equal(r.event, 'connect', (r as any).message);
      (r as any).socket.close();
    };

    for (const transport of ['websocket', 'polling']) {
      describe(`transport: ${transport}`, function () {
        for (const ns of ['/settings', '/pluginfw/installer']) {
          it(`${ns}: accepts a Host-rewriting proxy (Sec-Fetch-Site same-origin)`,
              async function () {
                await expectAccepted(openAdminSocket(ns, cookie, transport,
                    {origin: proxiedOrigin, secFetchSite: 'same-origin'}));
              });

          it(`${ns}: accepts a Host-rewriting proxy without Fetch Metadata, with token`,
              async function () {
                await expectAccepted(openAdminSocket(ns, cookie, transport,
                    {origin: 'http://pad.example.lan', token}));
              });

          it(`${ns}: rejects a sibling subdomain (Sec-Fetch-Site same-site)`, async function () {
            await expectRejected(openAdminSocket(ns, cookie, transport,
                {origin: siblingOrigin, secFetchSite: 'same-site'}));
          });

          it(`${ns}: rejects a cross-site page (Sec-Fetch-Site cross-site)`, async function () {
            await expectRejected(openAdminSocket(ns, cookie, transport,
                {origin: 'https://other.example.org', secFetchSite: 'cross-site'}));
          });

          it(`${ns}: rejects a sibling subdomain without Fetch Metadata or token`,
              async function () {
                await expectRejected(openAdminSocket(ns, cookie, transport,
                    {origin: siblingOrigin}));
              });

          it(`${ns}: rejects a token that belongs to another session`, async function () {
            await expectRejected(openAdminSocket(ns, cookie, transport,
                {origin: siblingOrigin, token: adminSocketToken('some-other-session')}));
          });

          it(`${ns}: rejects the literal null Origin`, async function () {
            await expectRejected(openAdminSocket(ns, cookie, transport, {origin: 'null'}));
          });

          it(`${ns}: accepts a same-origin admin session`, async function () {
            await expectAccepted(openAdminSocket(ns, cookie, transport, {origin: sameOrigin}));
          });

          it(`${ns}: accepts a client without Origin or Fetch Metadata (CLI)`,
              async function () {
                await expectAccepted(openAdminSocket(ns, cookie, transport));
              });

          it(`${ns}: accepts an origin listed in socketIo.allowedOrigins`, async function () {
            settings.socketIo.allowedOrigins = [siblingOrigin];
            await expectAccepted(openAdminSocket(ns, cookie, transport,
                {origin: siblingOrigin, secFetchSite: 'same-site'}));
          });
        }
      });
    }

    describe('originCheckMiddleware on a plugin namespace', function () {
      const ns = '/test-plugin-admin-ns';
      before(function () {
        // A plugin installs only the origin check; it must load the session
        // itself so the token path works.
        getIo().of(ns).use(originCheckMiddleware).on('connection', () => {});
      });

      it('accepts a token without a separate session middleware', async function () {
        await expectAccepted(openAdminSocket(ns, cookie, 'websocket',
            {origin: 'http://pad.example.lan', token}));
      });

      it('rejects a sibling subdomain', async function () {
        await expectRejected(openAdminSocket(ns, cookie, 'websocket',
            {origin: siblingOrigin, secFetchSite: 'same-site'}));
      });
    });

    it('an admin behind a Host-rewriting proxy can still load settings', async function () {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-socket-origin-'));
      const savedFilename = settings.settingsFilename;
      settings.settingsFilename = path.join(tmpDir, 'settings.json');
      fs.writeFileSync(settings.settingsFilename, '{"title": "origin-check"}');
      const r = await openAdminSocket('/settings', cookie, 'websocket',
          {origin: proxiedOrigin, secFetchSite: 'same-origin'});
      assert.equal(r.event, 'connect');
      const socket = (r as any).socket;
      try {
        const reply = await new Promise<any>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('no settings reply')), 8000);
          socket.once('settings', (d: any) => { clearTimeout(t); resolve(d); });
          socket.emit('load', null);
        });
        assert.ok(reply != null && 'results' in reply);
      } finally {
        socket.close();
        settings.settingsFilename = savedFilename;
        fs.rmSync(tmpDir, {recursive: true, force: true});
      }
    });
  });
});
