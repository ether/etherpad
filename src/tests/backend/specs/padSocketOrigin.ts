'use strict';

// Origin checks on the default (pad) socket.io namespace. The pad socket
// identifies the visitor from the cookies the browser attaches to the
// handshake (author token, group session, login session). A page on a sibling
// subdomain is same-site, so SameSite=Lax cookies are still sent with its
// handshake; with SameSite=None any site's are. Such a page must not get the
// visitor's identity, while Etherpad's own pages (also embedded, also behind a
// reverse proxy that rewrites Host) and non-browser clients keep working.

import {strict as assert} from 'assert';
import setCookieParser from 'set-cookie-parser';
import {
  isValidPadSocketToken, padCredentialBinding, padSocketToken, readCookieFromHeader,
} from '../../../node/utils/socketOrigin';

const io = require('socket.io-client');
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import settings from '../../../node/utils/Settings';

const padId = 'padSocketOriginTest';

const cookieHeaderFrom = (res: any): string => {
  const resCookies = setCookieParser.parse(res, {map: true});
  return Object.entries(resCookies)
      .map(([name, cookie]: [string, any]) => `${name}=${encodeURIComponent(cookie.value)}`)
      .join('; ');
};

type Opts = {
  origin?: string,
  secFetchSite?: string,
  token?: string,
  transport?: string,
};

type Outcome = {event: 'connect', socket: any} | {event: 'connect_error', message: string};

const open = (cookie: string, opts: Opts = {}): Promise<Outcome> => {
  const extraHeaders: Record<string, string> = {};
  if (opts.origin != null) extraHeaders.Origin = opts.origin;
  if (opts.secFetchSite != null) extraHeaders['Sec-Fetch-Site'] = opts.secFetchSite;
  const socket = io(`${common.baseUrl}/`, {
    forceNew: true,
    reconnection: false,
    transports: [opts.transport || 'polling'],
    query: {cookie, padId},
    extraHeaders,
    auth: opts.token == null ? {} : {padSocketToken: opts.token},
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('no connect/connect_error within 8s'));
    }, 8000);
    socket.once('connect', () => { clearTimeout(timeout); resolve({event: 'connect', socket}); });
    socket.once('connect_error', (err: any) => {
      clearTimeout(timeout);
      socket.close();
      resolve({event: 'connect_error', message: String(err && err.message)});
    });
  });
};

// Sends a CLIENT_READY with no in-message token or sessionID, like the
// current pad client, and returns the server's first reply.
const clientReady = async (socket: any) => {
  socket.emit('message', {component: 'pad', type: 'CLIENT_READY', padId});
  return await common.waitForSocketEvent(socket, 'message', 5000);
};

describe(__filename, function () {
  this.timeout(30000);

  describe('pad socket tokens', function () {
    it('bind the author token, group session and login session', function () {
      const base = {headers: {cookie: 'token=t.aaa; sessionID=s.bbb'}, session: {}, sessionID: 'x'};
      const b = padCredentialBinding(base, '');
      const tok = padSocketToken(b);
      assert.equal(isValidPadSocketToken(b, tok), true);
      // Different author token.
      assert.equal(isValidPadSocketToken(padCredentialBinding(
          {...base, headers: {cookie: 'token=t.zzz; sessionID=s.bbb'}}, ''), tok), false);
      // Different group session.
      assert.equal(isValidPadSocketToken(padCredentialBinding(
          {...base, headers: {cookie: 'token=t.aaa; sessionID=s.zzz'}}, ''), tok), false);
      // Same cookies but a logged-in express session.
      assert.equal(isValidPadSocketToken(padCredentialBinding(
          {...base, session: {user: {username: 'u'}}}, ''), tok), false);
      // An anonymous express session id is not part of the binding (it changes
      // on every request because anonymous sessions are not saved).
      assert.equal(isValidPadSocketToken(padCredentialBinding({...base, sessionID: 'y'}, ''), tok),
          true);
      assert.equal(isValidPadSocketToken(b, ''), false);
      assert.equal(isValidPadSocketToken(b, null), false);
      assert.equal(isValidPadSocketToken(b, 'x'.repeat(1000)), false);
    });

    it('honour the cookie prefix and fall back to the unprefixed sessionID', function () {
      const r = {headers: {cookie: 'ep_token=t.aaa; sessionID=s.bbb'}};
      assert.equal(padCredentialBinding(r, 'ep_'), JSON.stringify(['t.aaa', 's.bbb', '']));
    });

    it('readCookieFromHeader() treats undecodable values as absent', function () {
      assert.equal(readCookieFromHeader('a=%ZZ; b=1', 'a'), null);
      assert.equal(readCookieFromHeader('a=x%3Dy', 'a'), 'x=y');
      assert.equal(readCookieFromHeader(undefined, 'a'), null);
    });
  });

  describe('default namespace over socket.io', function () {
    let agent: any;
    let host: string;
    const sockets: any[] = [];
    const backups: any = {};

    before(async function () {
      agent = await common.init();
      host = new URL(common.baseUrl).host;
    });

    beforeEach(async function () {
      backups.socketIo = {...settings.socketIo};
      backups.requireAuthentication = settings.requireAuthentication;
      backups.users = settings.users;
      backups.trustProxy = settings.trustProxy;
      backups.publicURL = settings.publicURL;
      backups.hooks = {};
      for (const hookName of ['preAuthorize', 'authenticate', 'authorize']) {
        backups.hooks[hookName] = plugins.hooks[hookName];
        plugins.hooks[hookName] = [];
      }
      if (await padManager.doesPadExist(padId)) await (await padManager.getPad(padId)).remove();
    });

    afterEach(async function () {
      for (const s of sockets.splice(0)) s.close();
      settings.socketIo = backups.socketIo;
      settings.requireAuthentication = backups.requireAuthentication;
      settings.users = backups.users;
      settings.trustProxy = backups.trustProxy;
      settings.publicURL = backups.publicURL;
      Object.assign(plugins.hooks, backups.hooks);
      if (await padManager.doesPadExist(padId)) await (await padManager.getPad(padId)).remove();
    });

    const connected = async (cookie: string, opts: Opts = {}) => {
      const o = await open(cookie, opts);
      assert.equal(o.event, 'connect', o.event === 'connect_error' ? o.message : '');
      const {socket} = o as any;
      sockets.push(socket);
      return socket;
    };

    // The visitor's author ID, as seen by a trusted (non-browser) connection.
    const visitor = async () => {
      const res = await agent.get(`/p/${padId}`).expect(200);
      const cookie = cookieHeaderFrom(res);
      const msg: any = await clientReady(await connected(cookie));
      assert.equal(msg.type, 'CLIENT_VARS');
      return {cookie, authorId: msg.data.userId};
    };

    const tokenFor = async (cookie: string) => {
      const res = await agent.get('/pad-socket-token').set('Cookie', cookie).expect(200);
      assert.equal(typeof res.body.token, 'string');
      return res.body.token;
    };

    describe('GET /pad-socket-token', function () {
      it('is not cacheable and sends no CORS headers', async function () {
        const res = await agent.get('/pad-socket-token')
            .set('Origin', 'https://other.example.com').expect(200);
        assert.equal(res.headers['cache-control'], 'no-store');
        assert.equal(res.headers['access-control-allow-origin'], undefined);
        assert.equal(res.headers['access-control-allow-credentials'], undefined);
      });

      it('is reachable when requireAuthentication is on and no plugin authorizes it',
          async function () {
            settings.requireAuthentication = true;
            await agent.get('/pad-socket-token').expect(200);
          });
    });

    for (const transport of ['polling', 'websocket']) {
      describe(`transport: ${transport}`, function () {
        it('a client without Origin keeps its author (CLI, bots, load tests)', async function () {
          const {cookie, authorId} = await visitor();
          const msg: any = await clientReady(await connected(cookie, {transport}));
          assert.equal(msg.data.userId, authorId);
        });

        it('a page whose Origin matches Host keeps its author (embed, no proxy)',
            async function () {
              const {cookie, authorId} = await visitor();
              const msg: any = await clientReady(
                  await connected(cookie, {transport, origin: `http://${host}`}));
              assert.equal(msg.data.userId, authorId);
            });

        it('a Host-rewriting proxy keeps the author with Sec-Fetch-Site same-origin',
            async function () {
              // nginx `proxy_set_header Host $proxy_host`: Etherpad sees its
              // upstream address as Host and no X-Forwarded-Host; trustProxy
              // and publicURL unset.
              const {cookie, authorId} = await visitor();
              const msg: any = await clientReady(await connected(cookie, {
                transport, origin: 'https://pad.example.com', secFetchSite: 'same-origin',
              }));
              assert.equal(msg.data.userId, authorId);
            });

        it('a Host-rewriting proxy keeps the author without Fetch Metadata, with token',
            async function () {
              const {cookie, authorId} = await visitor();
              const msg: any = await clientReady(await connected(cookie, {
                transport, origin: 'https://pad.example.com', token: await tokenFor(cookie),
              }));
              assert.equal(msg.data.userId, authorId);
            });

        it('a sibling subdomain gets an anonymous author, not the visitor\'s',
            async function () {
              const {cookie, authorId} = await visitor();
              for (const secFetchSite of ['same-site', 'cross-site', undefined]) {
                const msg: any = await clientReady(await connected(cookie, {
                  transport, origin: 'https://other.example.com', secFetchSite,
                }));
                assert.equal(msg.type, 'CLIENT_VARS');
                assert.notEqual(msg.data.userId, authorId, `Sec-Fetch-Site: ${secFetchSite}`);
              }
            });

        it('a token issued for other cookies does not help', async function () {
          const {cookie, authorId} = await visitor();
          const other = await visitor();
          const msg: any = await clientReady(await connected(cookie, {
            transport, origin: 'https://other.example.com', token: await tokenFor(other.cookie),
          }));
          assert.notEqual(msg.data.userId, authorId);
        });

        it('"reject" refuses a foreign origin but not Etherpad\'s own pages', async function () {
          settings.socketIo = {...settings.socketIo, crossOriginPadSockets: 'reject'};
          const {cookie, authorId} = await visitor();
          const o = await open(cookie, {transport, origin: 'https://other.example.com'});
          assert.equal(o.event, 'connect_error');
          assert.equal((o as any).message, 'origin not allowed');
          const msg: any = await clientReady(await connected(cookie, {
            transport, origin: 'https://pad.example.com', token: await tokenFor(cookie),
          }));
          assert.equal(msg.data.userId, authorId);
        });

        it('"allow" restores the old behaviour', async function () {
          settings.socketIo = {...settings.socketIo, crossOriginPadSockets: 'allow'};
          const {cookie, authorId} = await visitor();
          const msg: any = await clientReady(
              await connected(cookie, {transport, origin: 'https://other.example.com'}));
          assert.equal(msg.data.userId, authorId);
        });

        it('an unknown policy refuses a foreign origin instead of failing open',
            async function () {
              settings.socketIo = {...settings.socketIo, crossOriginPadSockets: 'rejct' as any};
              const {cookie} = await visitor();
              const o = await open(cookie, {transport, origin: 'https://other.example.com'});
              assert.equal(o.event, 'connect_error');
              assert.equal((o as any).message, 'origin not allowed');
            });

        it('plugin hooks see no cookies or session on a foreign-origin socket',
            async function () {
              const {cookie} = await visitor();
              const seen: any[] = [];
              const backup = plugins.hooks.handleMessage;
              plugins.hooks.handleMessage = [{
                hook_fn: (hookName: string, ctx: any) => {
                  if (ctx.message?.type !== 'CLIENT_READY') return;
                  const req = ctx.socket.request;
                  seen.push({cookie: req.headers.cookie, user: req.session?.user,
                    sessionID: req.sessionID, save: typeof req.session?.save});
                },
                hook_fn_name: 'padSocketOriginTest/handleMessage',
                hook_name: 'handleMessage',
                part: {plugin: 'padSocketOriginTest'},
              }];
              try {
                await clientReady(
                    await connected(cookie, {transport, origin: 'https://other.example.com'}));
                await clientReady(await connected(cookie, {
                  transport, origin: 'https://pad.example.com', token: await tokenFor(cookie),
                }));
              } finally {
                plugins.hooks.handleMessage = backup;
              }
              assert.equal(seen.length, 2);
              assert.equal(seen[0].cookie, undefined);
              assert.equal(seen[0].user, undefined);
              assert.equal(seen[0].sessionID, undefined);
              assert.equal(seen[0].save, 'undefined');
              // Etherpad's own page keeps them.
              assert.match(seen[1].cookie, /token=/);
              assert.equal(seen[1].save, 'function');
            });

        it('socketIo.padAllowedOrigins and allowedOrigins are trusted', async function () {
          const {cookie, authorId} = await visitor();
          settings.socketIo = {...settings.socketIo, padAllowedOrigins: ['https://app.example.com']};
          let msg: any = await clientReady(
              await connected(cookie, {transport, origin: 'https://app.example.com'}));
          assert.equal(msg.data.userId, authorId);
          settings.socketIo = {...settings.socketIo, padAllowedOrigins: [],
            allowedOrigins: ['https://admin.example.com']};
          msg = await clientReady(
              await connected(cookie, {transport, origin: 'https://admin.example.com'}));
          assert.equal(msg.data.userId, authorId);
        });

        it('X-Forwarded-Host and publicURL count as this server', async function () {
          const {cookie, authorId} = await visitor();
          settings.trustProxy = true;
          const s = io(`${common.baseUrl}/`, {
            forceNew: true, reconnection: false, transports: [transport],
            query: {cookie, padId},
            extraHeaders: {'Origin': 'https://pad.example.com',
              'X-Forwarded-Host': 'pad.example.com'},
          });
          sockets.push(s);
          await common.waitForSocketEvent(s, 'connect', 5000);
          let msg: any = await clientReady(s);
          assert.equal(msg.data.userId, authorId);
          settings.trustProxy = false;
          settings.publicURL = 'https://pad.example.com';
          msg = await clientReady(
              await connected(cookie, {transport, origin: 'https://pad.example.com'}));
          assert.equal(msg.data.userId, authorId);
        });
      });
    }

    describe('requireAuthentication', function () {
      beforeEach(function () {
        settings.requireAuthentication = true;
        settings.users = {user: {password: 'user-password'}};
      });

      const login = async () => {
        const res = await agent.get(`/p/${padId}`).auth('user', 'user-password').expect(200);
        return cookieHeaderFrom(res);
      };

      it('a sibling subdomain cannot use the visitor\'s login', async function () {
        const cookie = await login();
        const msg: any = await clientReady(
            await connected(cookie, {origin: 'https://other.example.com'}));
        assert.equal(msg.accessStatus, 'deny');
      });

      it('plugin hooks do not see the visitor\'s login on a foreign-origin socket',
          async function () {
            const cookie = await login();
            // Let the join through without a login, so the message hooks run
            // and can look at the session the visitor's cookie points to.
            settings.requireAuthentication = false;
            const seen: any[] = [];
            const backup = plugins.hooks.handleMessageSecurity;
            plugins.hooks.handleMessageSecurity = [{
              hook_fn: (hookName: string, ctx: any) => {
                if (ctx.message?.type === 'CLIENT_READY') return;
                seen.push(ctx.socket.request.session?.user?.username ?? null);
              },
              hook_fn_name: 'padSocketOriginTest/handleMessageSecurity',
              hook_name: 'handleMessageSecurity',
              part: {plugin: 'padSocketOriginTest'},
            }];
            const sendChat = async (s: any) => {
              await clientReady(s);
              s.emit('message', {component: 'pad', type: 'COLLABROOM',
                data: {type: 'CHAT_MESSAGE', message: {text: 'hi', time: Date.now()}}});
              await new Promise((r) => setTimeout(r, 300));
            };
            try {
              await sendChat(await connected(cookie, {origin: 'https://other.example.com'}));
              await sendChat(await connected(cookie, {
                origin: 'https://pad.example.com', token: await tokenFor(cookie),
              }));
            } finally {
              plugins.hooks.handleMessageSecurity = backup;
            }
            // Etherpad's own page sees the login, the foreign page does not.
            assert.deepEqual(seen, [null, 'user']);
          });

      it('the pad page behind a Host-rewriting proxy can, with its token', async function () {
        const cookie = await login();
        const msg: any = await clientReady(await connected(cookie, {
          origin: 'https://pad.example.com', token: await tokenFor(cookie),
        }));
        assert.equal(msg.type, 'CLIENT_VARS');
      });

      it('a token fetched without the login cookie does not unlock it', async function () {
        const cookie = await login();
        const withoutLogin = cookie.split('; ').filter((c) => !/express_sid=/.test(c)).join('; ');
        const msg: any = await clientReady(await connected(cookie, {
          origin: 'https://other.example.com', token: await tokenFor(withoutLogin),
        }));
        assert.equal(msg.accessStatus, 'deny');
      });
    });
  });
});
