'use strict';

// Regression coverage for https://github.com/ether/etherpad/issues/7819.
// Drives the admin /settings socket against the running Docker container
// (test-container target) to prove the save flow actually writes a new
// top-level plugin block and the next `load` reads it back.
//
// Requires the container to be started with `-e ADMIN_PASSWORD=changeme1`
// so settings.json.docker provisions the admin user used here. Run via
// `pnpm run test-container` from the docker.yml workflow.

import {strict as assert} from 'assert';
import setCookieParser from 'set-cookie-parser';

const supertest = require('supertest');
const io = require('socket.io-client');

const BASE_URL = 'http://localhost:9001';
const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'changeme1';
const MARKER = 'persist-marker-7819';

// /admin-auth/ is the path webaccess.ts always treats as requireAdmin,
// regardless of settings.requireAuthentication. The container runs with
// REQUIRE_AUTHENTICATION=false (default), so GET /admin/ would NOT issue
// a Basic challenge and we'd never get a session cookie. POSTing to
// /admin-auth/ does.
const adminCookieHeader = async (): Promise<string> => {
  const res: any = await supertest(BASE_URL)
      .post('/admin-auth/')
      .auth(ADMIN_USER, ADMIN_PASSWORD);
  if (res.status !== 200) {
    throw new Error(
        `/admin-auth/ POST returned ${res.status} (expected 200) — ` +
        'is the container started with ADMIN_PASSWORD=changeme1? ' +
        `Body: ${String(res.text).slice(0, 200)}`);
  }
  const cookies = setCookieParser.parse(res, {map: true}) as Record<string, any>;
  if (Object.keys(cookies).length === 0) {
    throw new Error('/admin-auth/ returned 200 but set no cookies — session middleware not wired?');
  }
  return Object.entries(cookies)
      .map(([name, cookie]) => `${name}=${encodeURIComponent(cookie.value)}`)
      .join('; ');
};

const settingsSocket = async (cookieHdr: string) => {
  const socket = io(`${BASE_URL}/settings`, {
    forceNew: true,
    query: {cookie: cookieHdr},
    transports: ['websocket'],
  });
  await new Promise<void>((res, rej) => {
    const onErr = (err: any) => { socket.off('connect', onConn); rej(err); };
    const onConn = () => { socket.off('connect_error', onErr); res(); };
    socket.once('connect', onConn);
    socket.once('connect_error', onErr);
  });
  return socket;
};

const load = (socket: any): Promise<{results: string; resolved?: any; flags?: any}> =>
    new Promise((res, rej) => {
      // No reply == handler never registered, which means our session
      // wasn't admin. Surface that fast rather than burning the mocha
      // timeout — the adminsettings.ts connection handler silently
      // returns without binding any listeners when is_admin is false.
      const t = setTimeout(
          () => rej(new Error(
              'load: no `settings` reply within 8s — likely not authenticated as admin')),
          8000);
      socket.once('settings', (s: any) => { clearTimeout(t); res(s); });
      socket.emit('load', null);
    });

const save = (socket: any, payload: string): Promise<{status: string; detail?: any}> =>
    new Promise((res, rej) => {
      const t = setTimeout(
          () => rej(new Error('saveSettings: no saveprogress within 8s')), 8000);
      socket.once('saveprogress', (status: string, detail: any) => {
        clearTimeout(t);
        res({status, detail});
      });
      socket.emit('saveSettings', payload);
    });

describe('admin /settings socket (Docker container) — #7819', function () {
  this.timeout(20000);
  let socket: any;

  before(async function () {
    const cookieHdr = await adminCookieHeader();
    socket = await settingsSocket(cookieHdr);
    // Sanity: load works as admin. We don't keep the result — the file
    // we're about to save replaces settings.json entirely.
    const reply = await load(socket);
    assert.equal(typeof reply.results, 'string',
        'settings.results must be a string — container started without ADMIN_PASSWORD?');
  });

  after(function () {
    if (socket) socket.disconnect();
    // INTENTIONAL: do NOT restore baseline. docker.yml greps for MARKER
    // via `docker exec` after this suite, then runs `docker restart`,
    // then greps again — that whole chain proves the on-disk file
    // survives container restart, which is the actual #7819 ask. The
    // container is `docker rm -f`'d at the end of the workflow step, so
    // leftover state doesn't poison anything.
  });

  it('save → load round-trip preserves a top-level plugin block', async function () {
    // Hand-built minimal-but-viable settings document. Three reasons we
    // don't splice into the original:
    //   1. settings.json.docker uses jsonc `/* */` and `//` comments and
    //      keeps a trailing-comma-before-comment-before-close pattern
    //      that's annoying to patch correctly from the test side.
    //   2. The backend `saveSettings` handler writes bytes verbatim with
    //      zero validation — so what we save IS what should come back.
    //      Whether the payload is "realistic" is orthogonal to whether
    //      the file persists.
    //   3. After this save the container will be `docker restart`ed by
    //      the workflow. Minimal-but-viable means Etherpad starts back
    //      up: `port` is required by the HTTP server, `users.admin`
    //      keeps admin auth working post-restart, dbType=dirty keeps DB
    //      init happy.
    const augmented = JSON.stringify({
      title: 'Etherpad',
      ip: '0.0.0.0',
      port: 9001,
      dbType: 'dirty',
      dbSettings: {filename: 'var/dirty.db'},
      showSettingsInAdminPage: true,
      enableAdminUITests: true,
      users: {admin: {password: ADMIN_PASSWORD, is_admin: true}},
      ep_oauth: {
        clientID: MARKER,
        clientSecret: 'x',
        callbackURL: 'http://x/cb',
      },
    }, null, 2);

    const ack = await save(socket, augmented);
    assert.equal(ack.status, 'saved',
        `saveSettings did not ack 'saved' — got ${JSON.stringify(ack)}`);

    // Re-load over the same socket. adminsettings.ts re-reads
    // settings.settingsFilename on every `load`, so this reflects the
    // actual file on disk — not a client-side echo.
    const reply = await load(socket);
    assert.equal(reply.results, augmented,
        'load.results must equal the bytes we just saved');
    assert.ok(reply.results.includes('"ep_oauth"'),
        'ep_oauth block missing from next load — file on disk does not match payload');
    assert.ok(reply.results.includes(MARKER),
        `marker '${MARKER}' missing from next load`);
  });
});
