'use strict';

/**
 * Regression test for https://github.com/ether/etherpad/issues/7045.
 *
 * Before the fix, Etherpad's client-side JavaScript read the integrator-set
 * `sessionID` cookie via `document.cookie` and forwarded it in the socket.io
 * CLIENT_READY payload. That forced integrators to mark the cookie as
 * non-HttpOnly, exposing it to XSS.
 *
 * The fix moves the read to the server: `PadMessageHandler.handleClientReady`
 * now pulls `sessionID` out of the socket.io handshake's `Cookie` header so
 * integrators can mark the cookie `HttpOnly; Secure; SameSite=Lax`.
 *
 * The legacy message-level `sessionID` field is still accepted as a one-release
 * fallback, with a one-time warning per socket.
 */

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const {sessioninfos} = require('../../../node/handler/PadMessageHandler');
import settings from '../../../node/utils/Settings';
const io = require('socket.io-client');

const cookiePrefix = () => settings.cookie?.prefix || '';

describe(__filename, function () {
  this.timeout(30000);
  let socket: any;

  before(async function () { await common.init(); });

  beforeEach(async function () {
    assert(socket == null);
  });

  afterEach(async function () {
    if (socket) socket.close();
    socket = null;
    if (await padManager.doesPadExist('pad')) {
      const pad = await padManager.getPad('pad');
      await pad.remove();
    }
  });

  const connectWithCookie = async (cookieHeader: string) => {
    const s = io(`${common.baseUrl}/`, {
      forceNew: true,
      query: {cookie: cookieHeader, padId: 'pad'},
    });
    await common.waitForSocketEvent(s, 'connect', 5000);
    return s;
  };

  const sendClientReady = async (s: any, message: any) => {
    s.emit('message', {
      component: 'pad',
      type: 'CLIENT_READY',
      padId: 'pad',
      ...message,
    });
    const reply: any = await common.waitForSocketEvent(s, 'message', 5000);
    assert.equal(reply.type, 'CLIENT_VARS');
  };

  it('reads sessionID from the handshake Cookie header', async function () {
    socket = await connectWithCookie('sessionID=s.aaaaaaaaaaaaaaaa');
    await sendClientReady(socket, {});
    assert.equal(sessioninfos[socket.id].auth.sessionID, 's.aaaaaaaaaaaaaaaa');
  });

  it('honours the configured cookie prefix', async function () {
    socket = await connectWithCookie(`${cookiePrefix()}sessionID=s.bbbbbbbbbbbbbbbb`);
    await sendClientReady(socket, {});
    assert.equal(sessioninfos[socket.id].auth.sessionID, 's.bbbbbbbbbbbbbbbb');
  });

  it('falls back to message.sessionID for legacy clients (no cookie)', async function () {
    socket = await connectWithCookie('');
    await sendClientReady(socket, {sessionID: 's.cccccccccccccccc'});
    assert.equal(sessioninfos[socket.id].auth.sessionID, 's.cccccccccccccccc');
  });

  it('prefers the cookie over the legacy message field', async function () {
    socket = await connectWithCookie('sessionID=s.dddddddddddddddd');
    await sendClientReady(socket, {sessionID: 's.eeeeeeeeeeeeeeee'});
    assert.equal(sessioninfos[socket.id].auth.sessionID, 's.dddddddddddddddd');
  });

  it('records null when no sessionID is provided', async function () {
    socket = await connectWithCookie('');
    await sendClientReady(socket, {});
    assert.equal(sessioninfos[socket.id].auth.sessionID, null);
  });
});
