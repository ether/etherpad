'use strict';

/**
 * Regression test for https://github.com/ether/etherpad-lite/issues/4040
 *
 * Verifies that CLIENT_VARS sends a rev that matches the initialAttributedText.
 * Previously, pad.atext was captured at one point and pad.getHeadRevisionNumber()
 * was called later, creating a gap when concurrent edits advanced the revision.
 */

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import {randomString} from '../../../static/js/pad_utils';

describe(__filename, function () {
  let agent: any;
  let clientVarsBackup: any;

  before(async function () {
    agent = await common.init();
    clientVarsBackup = plugins.hooks.clientVars || [];
  });

  afterEach(function () {
    plugins.hooks.clientVars = clientVarsBackup;
  });

  it('CLIENT_VARS rev matches initialAttributedText state', async function () {
    this.timeout(30000);
    const padId = randomString(10);

    // Create a pad with initial text
    const pad = await padManager.getPad(padId, 'initial text\n');

    // Make several edits to advance the revision
    await pad.setText('edit one\n');
    await pad.setText('edit two\n');
    await pad.setText('edit three\n');
    const expectedText = pad.text();

    // Now connect a new client — CLIENT_VARS should be consistent
    const res = await agent.get(`/p/${padId}`).expect(200);
    const socket = await common.connect(res);
    try {
      const {type, data: clientVars} = await common.handshake(socket, padId);
      assert.equal(type, 'CLIENT_VARS');

      const collabVars = clientVars.collab_client_vars;

      // The rev in CLIENT_VARS must correspond to the initialAttributedText
      assert.equal(typeof collabVars.rev, 'number');

      // Verify the text from initialAttributedText matches the pad text
      const iatText = collabVars.initialAttributedText.text;
      assert.equal(iatText, expectedText,
        `initialAttributedText.text doesn't match pad text at rev ${collabVars.rev}`);
    } finally {
      socket.close();
      await pad.remove();
    }
  });

  it('client receives revisions created during clientVars hook await window', async function () {
    this.timeout(30000);
    const padId = randomString(10);
    const pad = await padManager.getPad(padId, 'start\n');

    // Install a slow clientVars hook that simulates a plugin doing async work.
    // While the hook is running the connecting socket has NOT yet joined the
    // room, so any edits broadcast in that window would normally be missed.
    let hookCalled = false;
    plugins.hooks.clientVars = [{
      hook_fn: async () => {
        hookCalled = true;
        // Mutate the pad while the hook is running — this edit happens after
        // the atext snapshot but before socket.join().
        await pad.setText('edited-during-hook\n');
        return {};
      },
    }];

    const res = await agent.get(`/p/${padId}`).expect(200);
    const socket = await common.connect(res);
    try {
      const {type, data: clientVars} = await common.handshake(socket, padId);
      assert.equal(type, 'CLIENT_VARS');
      assert.ok(hookCalled, 'clientVars hook should have been called');

      const collabVars = clientVars.collab_client_vars;
      const clientRev = collabVars.rev;

      // The pad was mutated during the hook. Thanks to the post-join
      // updatePadClients() call the server should push the missed revision(s)
      // to this socket. Collect any NEW_CHANGES messages that arrive.
      const headRev = pad.getHeadRevisionNumber();

      if (clientRev < headRev) {
        // We expect the server to send catch-up changesets.
        const msg = await common.waitForSocketEvent(socket, 'message');
        assert.equal(msg.type, 'COLLABROOM');
        assert.equal(msg.data.type, 'NEW_CHANGES');
        assert.ok(msg.data.newRev > clientRev,
          `Expected catch-up rev > ${clientRev}, got ${msg.data.newRev}`);
      }
      // Either way, the client should end up consistent — rev must be reachable.
      assert.ok(clientRev <= headRev,
        `CLIENT_VARS rev (${clientRev}) must not exceed head rev (${headRev})`);
    } finally {
      socket.close();
      plugins.hooks.clientVars = clientVarsBackup;
      await pad.remove();
    }
  });
});
