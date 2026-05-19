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

const adminCookieHeader = async (): Promise<string> => {
  const res: any = await supertest(BASE_URL)
      .get('/admin/')
      .auth(ADMIN_USER, ADMIN_PASSWORD);
  const cookies = setCookieParser.parse(res, {map: true}) as Record<string, any>;
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
    new Promise((res) => {
      socket.once('settings', res);
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
  let originalRaw: string;

  before(async function () {
    const cookieHdr = await adminCookieHeader();
    socket = await settingsSocket(cookieHdr);
    const reply = await load(socket);
    assert.equal(typeof reply.results, 'string',
        'settings.results must be a string — container started without ADMIN_PASSWORD?');
    originalRaw = reply.results;
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

  it('save → load round-trip preserves a new top-level plugin block', async function () {
    // Inject `"ep_oauth": {...},` right after the opening brace. Pure
    // textual splice — keeps every existing key/comment intact, which
    // is exactly what a user adding a plugin section would do.
    const augmented = originalRaw.replace(
        /^(\s*\{)/,
        `$1"ep_oauth":{"clientID":"${MARKER}","clientSecret":"x",` +
        '"callbackURL":"http://x/cb"},',
    );
    assert.notEqual(augmented, originalRaw, 'splice should have changed the string');
    assert.ok(augmented.includes(MARKER), 'sanity: marker is in payload');

    const ack = await save(socket, augmented);
    assert.equal(ack.status, 'saved',
        `saveSettings did not ack 'saved' — got ${JSON.stringify(ack)}`);

    // Re-load over the same socket. The server re-reads
    // settings.settingsFilename on every `load`, so this reflects the
    // actual file on disk — not a client-side echo.
    const reply = await load(socket);
    assert.ok(reply.results.includes('"ep_oauth"'),
        'ep_oauth block missing from next load — file on disk does not match payload');
    assert.ok(reply.results.includes(MARKER),
        `marker '${MARKER}' missing from next load`);
  });
});
