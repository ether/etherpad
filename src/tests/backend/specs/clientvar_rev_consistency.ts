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

  it('CLIENT_VARS rev matches initialAttributedText state at that exact rev', async function () {
    this.timeout(30000);
    const padId = randomString(10);

    // Create a pad with initial text
    const pad = await padManager.getPad(padId, 'initial text\n');

    // Make several edits to advance the revision
    await pad.setText('edit one\n');
    await pad.setText('edit two\n');
    await pad.setText('edit three\n');

    // Now connect a new client — CLIENT_VARS should be consistent
    const res = await agent.get(`/p/${padId}`).expect(200);
    const socket = await common.connect(res);
    try {
      const {type, data: clientVars} = await common.handshake(socket, padId);
      assert.equal(type, 'CLIENT_VARS');

      const collabVars = clientVars.collab_client_vars;
      assert.equal(typeof collabVars.rev, 'number');

      // The core invariant: the initialAttributedText must correspond to the
      // EXACT revision advertised in collabVars.rev (not just the latest pad
      // text). Validate this by fetching the historical AText for that rev.
      const atextAtRev = await pad.getInternalRevisionAText(collabVars.rev);
      assert.equal(atextAtRev.text, collabVars.initialAttributedText.text,
        `initialAttributedText.text doesn't match pad AText at rev ${collabVars.rev}`);
      assert.equal(atextAtRev.attribs, collabVars.initialAttributedText.attribs,
        `initialAttributedText.attribs doesn't match pad AText at rev ${collabVars.rev}`);
    } finally {
      socket.close();
      await pad.remove();
    }
  });

  it('CLIENT_VARS is consistent when an edit lands between handshake start and finish',
      async function () {
    // Reproduces the original race: a new client opens the pad while another
    // process mutates it. The advertised rev / initialAttributedText must
    // always correspond, even if the pad has advanced past that rev by the
    // time the client receives CLIENT_VARS.
    this.timeout(30000);
    const padId = randomString(10);
    const pad = await padManager.getPad(padId, 'rev0\n');

    // Inject a slow clientVars hook that mutates the pad mid-handshake.
    // This is the most reliable way to force the race window without an
    // open-ended background loop that can stall ueberDB at shutdown.
    let edits = 0;
    plugins.hooks.clientVars = [{
      hook_fn: async () => {
        // Land a couple of edits while the server is still preparing
        // CLIENT_VARS — the bug surfaces when the rev advances after the
        // atext snapshot but before the rev is read.
        for (let i = 0; i < 3; i++) {
          await pad.setText(`mid-handshake-edit-${edits++}\n`);
        }
        return {};
      },
    }];

    try {
      const res = await agent.get(`/p/${padId}`).expect(200);
      const socket = await common.connect(res);
      try {
        const {type, data: clientVars} = await common.handshake(socket, padId);
        assert.equal(type, 'CLIENT_VARS');
        const collabVars = clientVars.collab_client_vars;
        // Validate that initialAttributedText matches the AText at the
        // advertised rev — the exact invariant whose violation produced
        // "mismatched apply" errors.
        const atextAtRev = await pad.getInternalRevisionAText(collabVars.rev);
        assert.equal(atextAtRev.text, collabVars.initialAttributedText.text,
          `AText mismatch at rev ${collabVars.rev}`);
      } finally {
        socket.close();
      }
    } finally {
      plugins.hooks.clientVars = clientVarsBackup;
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
      // Collect all messages received during and after handshake so we don't
      // miss NEW_CHANGES that arrive before we start explicitly listening.
      const messages: any[] = [];
      socket.on('message', (msg: any) => messages.push(msg));

      const {type, data: clientVars} = await common.handshake(socket, padId);
      assert.equal(type, 'CLIENT_VARS');
      assert.ok(hookCalled, 'clientVars hook should have been called');

      const collabVars = clientVars.collab_client_vars;
      const clientRev = collabVars.rev;
      const headRev = pad.getHeadRevisionNumber();

      if (clientRev < headRev) {
        // Wait a moment for any in-flight messages to arrive.
        await new Promise((r) => setTimeout(r, 500));
        const catchUp = messages.find(
          (m: any) => m.type === 'COLLABROOM' && m.data?.type === 'NEW_CHANGES');
        assert.ok(catchUp, 'Expected a NEW_CHANGES catch-up message');
        assert.ok(catchUp.data.newRev > clientRev,
          `Expected catch-up rev > ${clientRev}, got ${catchUp.data.newRev}`);
      }
      assert.ok(clientRev <= headRev,
        `CLIENT_VARS rev (${clientRev}) must not exceed head rev (${headRev})`);
    } finally {
      socket.close();
      plugins.hooks.clientVars = clientVarsBackup;
      await pad.remove();
    }
  });
});
