'use strict';

/**
 * Pins the socket.io message sequence + shapes that every realtime client
 * depends on: handshake -> CLIENT_VARS, then USER_CHANGES -> ACCEPT_COMMIT.
 * A change here is a wire-protocol change that will break downstream clients
 * (the Rust terminal editor and the Node CLI both speak this sequence by hand).
 */

const assert = require('assert').strict;
const common = require('../../common');
const padManager = require('../../../../node/db/PadManager');

describe(__filename, function () {
  let agent: any;
  let socket: any;
  let pad: any;
  let padId: string;

  before(async function () { agent = await common.init(); });

  beforeEach(async function () {
    padId = common.randomString();
    pad = await padManager.getPad(padId, 'dummy\n');
    await pad.setText('\n'); // ensure the pad exists at a known empty state
    const res = await agent.get(`/p/${padId}`).expect(200);
    socket = await common.connect(res);
  });

  afterEach(async function () {
    if (socket != null) socket.close();
    socket = null;
    if (pad != null) await pad.remove();
    pad = null;
  });

  it('handshake returns CLIENT_VARS with the client-facing shape', async function () {
    const {type, data} = await common.handshake(socket, padId);
    assert.equal(type, 'CLIENT_VARS');
    assert.ok(data.userId, 'CLIENT_VARS.userId missing');
    assert.ok(data.collab_client_vars, 'collab_client_vars missing');
    assert.equal(typeof data.collab_client_vars.rev, 'number');
    assert.ok(data.collab_client_vars.initialAttributedText,
      'collab_client_vars.initialAttributedText missing');
  });

  it('USER_CHANGES is acknowledged with ACCEPT_COMMIT and a bumped rev', async function () {
    const {data: clientVars} = await common.handshake(socket, padId);
    const rev = clientVars.collab_client_vars.rev;
    const authorId = clientVars.userId;
    // Insert ops must carry the session author attribute (`*0+N` + matching
    // apool entry) or the server rejects with {disconnect:'badChangeset'}.
    const apool = {numToAttrib: {0: ['author', authorId]}, nextNum: 1};
    await Promise.all([
      common.waitForAcceptCommit(socket, rev + 1),
      common.sendUserChanges(socket, {baseRev: rev, changeset: 'Z:1>5*0+5$hello', apool}),
    ]);
    assert.equal(pad.text(), 'hello\n');
  });
});
