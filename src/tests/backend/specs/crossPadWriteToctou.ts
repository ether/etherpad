'use strict';

/**
 * Regression for GHSA-6mcx-x5h6-rpw2 (PadMessageHandler cross-pad write TOCTOU).
 *
 * A USER_CHANGES message is authorized (access + read-only gate) against the pad
 * the session points at when the message arrives, but the write ran later off
 * mutable session state. A concurrent same-socket CLIENT_READY could swap
 * sessioninfos[socket.id].padId during the awaits in handleMessage(), redirecting
 * the queued write onto a read-only / unauthorized pad.
 *
 * This test drives a real USER_CHANGES over a socket and, via a
 * handleMessageSecurity hook (which runs during those awaits), swaps the
 * session's padId to a victim pad — exactly the concurrent-CLIENT_READY race.
 * The change must still land on the pad the message was authorized against, and
 * never on the victim.
 */

import {MapArrayType} from '../../../node/types/MapType';

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
const padMessageHandler = require('../../../node/handler/PadMessageHandler');

describe(__filename, function () {
  this.timeout(30000);
  let agent: any;
  const backups: MapArrayType<any> = {};

  before(async function () { agent = await common.init(); });

  beforeEach(function () {
    backups.hooks = {handleMessageSecurity: plugins.hooks.handleMessageSecurity};
    plugins.hooks.handleMessageSecurity = [];
  });
  afterEach(function () {
    Object.assign(plugins.hooks, backups.hooks);
  });

  it('a mid-message pad swap cannot redirect the write onto another pad', async function () {
    // Authorized (writable) pad the client is editing.
    const authorizedId = `toctou_ok_${common.randomString()}`;
    const authorizedPad = await padManager.getPad(authorizedId, 'seed\n');
    await authorizedPad.setText('seed\n');
    // Victim pad with identical text, so the changeset is valid against either
    // pad — the test distinguishes purely by which pad receives the write.
    const victimId = `toctou_victim_${common.randomString()}`;
    const victimPad = await padManager.getPad(victimId, 'seed\n');
    await victimPad.setText('seed\n');

    const res = await agent.get(`/p/${authorizedId}`).expect(200);
    const socket = await common.connect(res);
    try {
      const {data: clientVars} = await common.handshake(socket, authorizedId);
      const rev = clientVars.collab_client_vars.rev;
      const authorId = clientVars.userId;

      // Simulate the concurrent same-socket CLIENT_READY: while THIS USER_CHANGES
      // is mid-flight (handleMessageSecurity runs during handleMessage's awaits),
      // swap the session's padId to the victim pad in place.
      plugins.hooks.handleMessageSecurity = [{
        hook_fn: (hookName: string, ctx: any) => {
          if (ctx.message?.data?.type === 'USER_CHANGES') {
            padMessageHandler.sessioninfos[ctx.socket.id].padId = victimId;
          }
        },
        hook_fn_name: 'toctou/handleMessageSecurity',
        hook_name: 'handleMessageSecurity',
        part: {plugin: 'toctou'},
      }];

      const accept = common.waitForSocketEvent(socket, 'message');
      await common.sendUserChanges(socket, {
        baseRev: rev,
        changeset: 'Z:5>2*0+2$ZZ',
        apool: {numToAttrib: {0: ['author', authorId]}, nextNum: 1},
      });
      await accept; // wait for the server to finish applying

      assert.equal(victimPad.text(), 'seed\n',
          'the victim pad (swapped session padId) must NOT be modified');
      assert.equal(authorizedPad.text(), 'ZZseed\n',
          'the change must land on the pad the message was authorized against');
    } finally {
      socket.close();
      await authorizedPad.remove();
      await victimPad.remove();
    }
  });
});
