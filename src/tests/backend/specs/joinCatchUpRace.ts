'use strict';

/**
 * The catch-up updatePadClients() call at the end of handleClientReady() (added in #7480) runs
 * outside the per-pad USER_CHANGES queue. If a client joins while another client's USER_CHANGES
 * is between pad.appendRevision() and the `assert.equal(thisSession.rev, r)` check, the catch-up
 * advances the writer's session rev and the writer is disconnected with badChangeset.
 */

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const padMessageHandler = require('../../../node/handler/PadMessageHandler');
const plugins = require('../../../static/js/pluginfw/plugin_defs');

describe(__filename, function () {
  let agent: any;
  let pad: any;
  let padId: string;
  const sockets: any[] = [];
  let hooksBackup: any;
  let updatePadClientsBackup: any;

  before(async function () {
    agent = await common.init();
  });

  beforeEach(async function () {
    hooksBackup = {handleMessageSecurity: plugins.hooks.handleMessageSecurity};
    updatePadClientsBackup = padMessageHandler.updatePadClients;
    padId = common.randomString();
    pad = await padManager.getPad(padId, '\n');
    await pad.setText('\n');
  });

  afterEach(async function () {
    Object.assign(plugins.hooks, hooksBackup);
    padMessageHandler.updatePadClients = updatePadClientsBackup;
    for (const s of sockets.splice(0)) s.close();
    if (pad != null) await pad.remove();
    pad = null;
  });

  const join = async () => {
    const res = await agent.get(`/p/${padId}`).expect(200);
    const socket = await common.connect(res);
    sockets.push(socket);
    const {type, data} = await common.handshake(socket, padId);
    assert.equal(type, 'CLIENT_VARS');
    return {socket, rev: data.collab_client_vars.rev, authorId: data.userId};
  };

  it('a join during another user\'s USER_CHANGES does not reject that change', async function () {
    this.timeout(20000);
    const writer = await join();

    // Hold the writer's USER_CHANGES right after the revision was appended.
    let reached: () => void;
    const reachedP = new Promise<void>((r) => { reached = r; });
    let release: () => void;
    const releaseP = new Promise<void>((r) => { release = r; });
    const origAppend = pad.appendRevision.bind(pad);
    pad.appendRevision = async (...args: any[]) => {
      const newRev = await origAppend(...args);
      pad.appendRevision = origAppend;
      reached();
      await releaseP;
      return newRev;
    };

    const writerMsgs: any[] = [];
    writer.socket.on('message', (msg: any) => writerMsgs.push(msg));
    common.sendUserChanges(writer.socket, {
      baseRev: writer.rev,
      changeset: 'Z:1>5*0+5$hello',
      apool: {numToAttrib: {0: ['author', writer.authorId]}, nextNum: 1},
    }).catch(() => {});
    await reachedP;

    // Somebody joins while the change is in flight.
    let catchUpDone: () => void;
    const catchUpDoneP = new Promise<void>((r) => { catchUpDone = r; });
    padMessageHandler.updatePadClients = async (...args: any[]) => {
      const result = await updatePadClientsBackup(...args);
      catchUpDone();
      return result;
    };
    await join();
    // CLIENT_VARS is emitted before handleClientReady() performs its catch-up.
    // Wait for updatePadClients() itself so this test cannot release the writer
    // before the join handler reaches the raced operation.
    await catchUpDoneP;
    release!();
    await new Promise((r) => setTimeout(r, 500));

    const types = writerMsgs.map((m) => m.disconnect ? `disconnect:${m.disconnect}` : m.data?.type);
    assert.deepEqual(types.filter((t) => t !== 'USER_NEWINFO'), ['ACCEPT_COMMIT'],
        `writer got ${JSON.stringify(types)}`);
    assert.equal(pad.text(), 'hello\n');
  });
});
