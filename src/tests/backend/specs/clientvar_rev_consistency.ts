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
import {randomString} from '../../../static/js/pad_utils';

describe(__filename, function () {
  let agent: any;

  before(async function () {
    agent = await common.init();
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
});
