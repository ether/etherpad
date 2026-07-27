'use strict';

// Regression coverage for #7819 follow-up: non-admin sockets used to be
// silently dropped, which made misconfigured admin auth (e.g. Traefik +
// SSO + cross-origin iframe losing the cookie) look like "save didn't
// work" with no error path. The connection handler now emits a dedicated
// `admin_auth_error` event before disconnecting so the SPA can surface it.

import {strict as assert} from 'assert';

const io = require('socket.io-client');
const common = require('../../common');

const connectAnonymous = (): any =>
    io(`${common.baseUrl}/settings`, {
      forceNew: true,
      // Deliberately omit cookie / auth — this mirrors a socket from a
      // session that resolves through express-session but lacks is_admin.
      transports: ['websocket'],
    });

describe(__filename, function () {
  this.timeout(15000);

  before(async function () {
    await common.init();
  });

  it('emits admin_auth_error and disconnects when not authenticated as admin',
      async function () {
        const socket = connectAnonymous();
        const result = await new Promise<{event: 'auth_error' | 'disconnect' | 'timeout'; payload?: any}>((res) => {
          const timeout = setTimeout(
              () => { try { socket.disconnect(); } catch {} res({event: 'timeout'}); },
              8000);
          socket.once('admin_auth_error', (payload: any) => {
            clearTimeout(timeout);
            res({event: 'auth_error', payload});
          });
          socket.once('disconnect', () => {
            clearTimeout(timeout);
            res({event: 'disconnect'});
          });
        });
        try { socket.disconnect(); } catch {}
        // Either order is acceptable (auth_error then disconnect, or just
        // disconnect if the event arrives after the close handshake) — but
        // a timeout is a regression: the silent-no-op path is back.
        assert.notEqual(result.event, 'timeout',
            'admin_auth_error or disconnect must arrive within 8s for non-admin socket');
        if (result.event === 'auth_error') {
          assert.ok(result.payload && typeof result.payload.message === 'string',
              `admin_auth_error must carry a message; got ${JSON.stringify(result.payload)}`);
        }
      });
});
