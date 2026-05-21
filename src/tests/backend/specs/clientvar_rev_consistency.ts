'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';

/**
 * Regression test for https://github.com/ether/etherpad-lite/issues/4040
 *
 * Verifies that CLIENT_VARS sends a rev that matches the initialAttributedText.
 * Previously, pad.atext was captured at one point and pad.getHeadRevisionNumber()
 * was called later, creating a gap when concurrent edits advanced the revision.
 *
 * The whole suite runs with `settings.loadTest = true`. That mode bypasses
 * socket.io auth and is the documented way to run "load-style" tests against
 * Etherpad, so this is the configuration where the original "mismatched apply"
 * production failures were observed.
 */

import assert from 'assert';
import * as common from '../common.js';
import * as padManager from '../../../node/db/PadManager.js';
import pluginDefs from '../../../static/js/pluginfw/plugin_defs.js';
import settings from '../../../node/utils/Settings.js';
import {randomString} from '../../../static/js/pad_utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const plugins = pluginDefs;

describe(__filename, function () {
  let agent: any;
  let clientVarsBackup: any;
  let loadTestBackup: boolean;

  before(async function () {
    loadTestBackup = settings.loadTest;
    settings.loadTest = true;
    agent = await common.init();
    clientVarsBackup = plugins.hooks.clientVars || [];
  });

  after(function () {
    settings.loadTest = loadTestBackup;
  });

  afterEach(function () {
    plugins.hooks.clientVars = clientVarsBackup;
  });

  it('CLIENT_VARS rev matches initialAttributedText state at that exact rev', async function () {
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

  it('CLIENT_VARS stays consistent under concurrent edits during handshake (delay race)',
      async function () {
    // Reproduces the original "mismatched apply" race condition:
    //   1. The server captures pad.atext for CLIENT_VARS.
    //   2. Time passes (a slow plugin hook, network jitter, GC pause, ...).
    //   3. While that's happening, another process mutates the pad.
    //   4. CLIENT_VARS is finally sent — pre-fix this advertised the
    //      *new* rev with the *old* atext.
    // We exercise this exact window via a slow clientVars hook that
    //   (a) introduces a measurable delay so steps 1 and 4 are not adjacent,
    //   (b) lands several edits during that delay.
    // The bug also applied at higher load — to also reproduce the load
    // scenario, we pre-populate the pad with many revisions before connecting.
    const padId = randomString(10);
    const pad = await padManager.getPad(padId, 'rev0\n');

    // Pre-populate to put the pad in a "busy" state (high rev count).
    // Bounded so it can't hang on shutdown.
    for (let i = 0; i < 20; i++) {
      await pad.setText(`pre-load-${i}\n`);
    }
    const preConnectRev = pad.getHeadRevisionNumber();

    // Inject a slow clientVars hook that:
    //  - waits long enough to make the race window observable, and
    //  - lands additional edits during that wait.
    let edits = 0;
    plugins.hooks.clientVars = [{
      hook_fn: async () => {
        // Sleep to widen the window between atext snapshot and CLIENT_VARS send.
        await new Promise((r) => setTimeout(r, 200));
        for (let i = 0; i < 5; i++) {
          await pad.setText(`mid-handshake-edit-${edits++}\n`);
        }
        // Sleep again so any catch-up logic on the server has to deal with
        // a long-since-stale snapshot.
        await new Promise((r) => setTimeout(r, 200));
        return {};
      },
    }];

    try {
      const res = await agent.get(`/p/${padId}`).expect(200);
      const socket = await common.connect(res);
      try {
        // Listen for catch-up NEW_CHANGES messages alongside the handshake.
        const messages: any[] = [];
        socket.on('message', (msg: any) => messages.push(msg));

        const {type, data: clientVars} = await common.handshake(socket, padId);
        assert.equal(type, 'CLIENT_VARS');
        const collabVars = clientVars.collab_client_vars;
        const advertisedRev = collabVars.rev;

        // Pre-fix this would have been violated: rev would point past atext.
        // Validate the AText matches the pad AText AT THE ADVERTISED REV
        // (not just the latest pad text), which is the exact invariant whose
        // violation produced "mismatched apply" errors.
        const atextAtRev = await pad.getInternalRevisionAText(advertisedRev);
        assert.equal(atextAtRev.text, collabVars.initialAttributedText.text,
          `AText mismatch at rev ${advertisedRev}`);
        assert.equal(atextAtRev.attribs, collabVars.initialAttributedText.attribs,
          `AText attribs mismatch at rev ${advertisedRev}`);

        // The advertised rev must be at least the pre-connect head — anything
        // older would mean we shipped a stale snapshot.
        assert.ok(advertisedRev >= preConnectRev,
          `CLIENT_VARS rev (${advertisedRev}) is older than pre-connect head (${preConnectRev})`);

        // Wait briefly for in-flight catch-up messages.
        await new Promise((r) => setTimeout(r, 500));
        const finalHead = pad.getHeadRevisionNumber();
        if (advertisedRev < finalHead) {
          const catchUp = messages.find(
            (m: any) => m.type === 'COLLABROOM' && m.data?.type === 'NEW_CHANGES');
          assert.ok(catchUp,
            `Expected NEW_CHANGES catch-up after CLIENT_VARS (rev ${advertisedRev} -> ${finalHead})`);
        }
      } finally {
        socket.close();
      }
    } finally {
      plugins.hooks.clientVars = clientVarsBackup;
      await pad.remove();
    }
  });

  it('client receives revisions created during clientVars hook await window', async function () {
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
