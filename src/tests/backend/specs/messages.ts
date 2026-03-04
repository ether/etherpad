'use strict';

import {PadType} from "../../../node/types/PadType";
import {MapArrayType} from "../../../node/types/MapType";

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import readOnlyManager from '../../../node/db/ReadOnlyManager';

describe(__filename, function () {
  let agent:any;
  let pad:PadType|null;
  let padId: string;
  let roPadId: string;
  let rev: number;
  let socket: any;
  let roSocket: any;
  const backups:MapArrayType<any> = {};

  before(async function () {
    agent = await common.init();
  });

  beforeEach(async function () {
    backups.hooks = {handleMessageSecurity: plugins.hooks.handleMessageSecurity};
    plugins.hooks.handleMessageSecurity = [];
    padId = common.randomString();
    assert(!await padManager.doesPadExist(padId));
    pad = await padManager.getPad(padId, 'dummy text\n');
    await pad!.setText('\n'); // Make sure the pad is created.
    assert.equal(pad!.text(), '\n');
    let res = await agent.get(`/p/${padId}`).expect(200);
    socket = await common.connect(res);
    const {type, data: clientVars} = await common.handshake(socket, padId);
    assert.equal(type, 'CLIENT_VARS');
    rev = clientVars.collab_client_vars.rev;

    roPadId = await readOnlyManager.getReadOnlyId(padId);
    res = await agent.get(`/p/${roPadId}`).expect(200);
    roSocket = await common.connect(res);
    await common.handshake(roSocket, roPadId);
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterEach(async function () {
    Object.assign(plugins.hooks, backups.hooks);
    if (socket != null) socket.close();
    socket = null;
    if (roSocket != null) roSocket.close();
    roSocket = null;
    if (pad != null) await pad.remove();
    pad = null;
  });

  describe('CHANGESET_REQ', function () {
    it('users are unable to read changesets from other pads', async function () {
      const otherPadId = `${padId}other`;
      assert(!await padManager.doesPadExist(otherPadId));
      const otherPad = await padManager.getPad(otherPadId, 'other text\n');
      try {
        await otherPad.setText('other text\n');
        const resP = common.waitForSocketEvent(roSocket, 'message');
        await common.sendMessage(roSocket, {
          component: 'pad',
          padId: otherPadId, // The server should ignore this.
          type: 'CHANGESET_REQ',
          data: {
            granularity: 1,
            start: 0,
            requestID: 'requestId',
          },
        });
        const res = await resP;
        assert.equal(res.type, 'CHANGESET_REQ');
        assert.equal(res.data.requestID, 'requestId');
        // Should match padId's text, not otherPadId's text.
        assert.match(res.data.forwardsChangesets[0], /^[^$]*\$dummy text\n/);
      } finally {
        await otherPad.remove();
      }
    });

    it('CHANGESET_REQ: verify revNum is a number (regression)', async function () {
      const otherPadId = `${padId}other`;
      assert(!await padManager.doesPadExist(otherPadId));
      const otherPad = await padManager.getPad(otherPadId, 'other text\n');
      let errorCatched = 0;
      try {
        await otherPad.setText('other text\n');
        await common.sendMessage(roSocket, {
          component: 'pad',
          padId: otherPadId, // The server should ignore this.
          type: 'CHANGESET_REQ',
          data: {
            granularity: 1,
            start: 'test123',
            requestID: 'requestId',
          },
        });
        assert.equal('This code should never run', 1);
      }
      catch(e:any) {
        assert.match(e.message, /rev is not a number/);
        errorCatched = 1;
      }
      finally {
        await otherPad.remove();
        assert.equal(errorCatched, 1);
      }
    });

    it('CHANGESET_REQ: revNum is converted to number if possible (regression)', async function () {
      const otherPadId = `${padId}other`;
      assert(!await padManager.doesPadExist(otherPadId));
      const otherPad = await padManager.getPad(otherPadId, 'other text\n');
      try {
        await otherPad.setText('other text\n');
        const resP = common.waitForSocketEvent(roSocket, 'message');
        await common.sendMessage(roSocket, {
          component: 'pad',
          padId: otherPadId, // The server should ignore this.
          type: 'CHANGESET_REQ',
          data: {
            granularity: 1,
            start: '1test123',
            requestID: 'requestId',
          },
        });
        const res = await resP;
        assert.equal(res.type, 'CHANGESET_REQ');
        assert.equal(res.data.requestID, 'requestId');
        assert.equal(res.data.start, 1);
      }
      finally {
        await otherPad.remove();
      }
    });

    it('CHANGESET_REQ: revNum 2 is converted to head rev 1 (regression)', async function () {
      const otherPadId = `${padId}other`;
      assert(!await padManager.doesPadExist(otherPadId));
      const otherPad = await padManager.getPad(otherPadId, 'other text\n');
      try {
        await otherPad.setText('other text\n');
        const resP = common.waitForSocketEvent(roSocket, 'message');
        await common.sendMessage(roSocket, {
          component: 'pad',
          padId: otherPadId, // The server should ignore this.
          type: 'CHANGESET_REQ',
          data: {
            granularity: 1,
            start: '2',
            requestID: 'requestId',
          },
        });
        const res = await resP;
        assert.equal(res.type, 'CHANGESET_REQ');
        assert.equal(res.data.requestID, 'requestId');
        assert.equal(res.data.start, 1);
      }
      finally {
        await otherPad.remove();
      }
    });
  });

  describe('USER_CHANGES', function () {
    const sendUserChanges =
        async (socket:any, cs:any) => await common.sendUserChanges(socket, {baseRev: rev, changeset: cs});
    const assertAccepted = async (socket:any, wantRev: number) => {
      await common.waitForAcceptCommit(socket, wantRev);
      rev = wantRev;
    };
    const assertRejected = async (socket:any) => {
      const msg = await common.waitForSocketEvent(socket, 'message');
      assert.deepEqual(msg, {disconnect: 'badChangeset'});
    };

    it('changes are applied', async function () {
      await Promise.all([
        assertAccepted(socket, rev + 1),
        sendUserChanges(socket, 'Z:1>5+5$hello'),
      ]);
      assert.equal(pad!.text(), 'hello\n');
    });

    it('bad changeset is rejected', async function () {
      await Promise.all([
        assertRejected(socket),
        sendUserChanges(socket, 'this is not a valid changeset'),
      ]);
    });

    it('retransmission is accepted, has no effect', async function () {
      const cs = 'Z:1>5+5$hello';
      await Promise.all([
        assertAccepted(socket, rev + 1),
        sendUserChanges(socket, cs),
      ]);
      --rev;
      await Promise.all([
        assertAccepted(socket, rev + 1),
        sendUserChanges(socket, cs),
      ]);
      assert.equal(pad!.text(), 'hello\n');
    });

    it('identity changeset is accepted, has no effect', async function () {
      await Promise.all([
        assertAccepted(socket, rev + 1),
        sendUserChanges(socket, 'Z:1>5+5$hello'),
      ]);
      await Promise.all([
        assertAccepted(socket, rev),
        sendUserChanges(socket, 'Z:6>0$'),
      ]);
      assert.equal(pad!.text(), 'hello\n');
    });

    it('non-identity changeset with no net change is accepted, has no effect', async function () {
      await Promise.all([
        assertAccepted(socket, rev + 1),
        sendUserChanges(socket, 'Z:1>5+5$hello'),
      ]);
      await Promise.all([
        assertAccepted(socket, rev),
        sendUserChanges(socket, 'Z:6>0-5+5$hello'),
      ]);
      assert.equal(pad!.text(), 'hello\n');
    });

    it('handleMessageSecurity can grant one-time write access', async function () {
      const cs = 'Z:1>5+5$hello';
      const errRegEx = /write attempt on read-only pad/;
      // First try to send a change and verify that it was dropped.
      await assert.rejects(sendUserChanges(roSocket, cs), errRegEx);
      // sendUserChanges() waits for message ack, so if the message was accepted then head should
      // have already incremented by the time we get here.
      assert.equal(pad!.head, rev); // Not incremented.

      // Now allow the change.
      plugins.hooks.handleMessageSecurity.push({hook_fn: () => 'permitOnce'});
      await Promise.all([
        assertAccepted(roSocket, rev + 1),
        sendUserChanges(roSocket, cs),
      ]);
      assert.equal(pad!.text(), 'hello\n');

      // The next change should be dropped.
      plugins.hooks.handleMessageSecurity = [];
      await assert.rejects(sendUserChanges(roSocket, 'Z:6>6=5+6$ world'), errRegEx);
      assert.equal(pad!.head, rev); // Not incremented.
      assert.equal(pad!.text(), 'hello\n');
    });
  });
});
