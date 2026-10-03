'use strict';

/**
 * updatePadClients() fan-out must not double-send a revision to a client
 * (#7756 lever 3).
 *
 * The per-socket loop reads `sessioninfo.rev`, awaits `pad.getRevision()`, then
 * writes `sessioninfo.rev` back. That read-await-write is not atomic, so two
 * concurrent fan-outs for the same pad both start from the same rev and both emit
 * it. The client applies the changeset twice and its revision numbering diverges
 * from the server's.
 *
 * Guarded by `sessioninfo.fanOutInFlight`, deliberately NOT by pre-claiming
 * `sessioninfo.rev`: handleUserChanges asserts `thisSession.rev === r` to keep
 * NEW_CHANGES and ACCEPT_COMMIT ordered on the wire, and that assert is only
 * meaningful while `rev` means "already sent".
 */

import {PadType} from '../../../node/types/PadType';

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const padMessageHandler = require('../../../node/handler/PadMessageHandler');

let agent: any;

describe(__filename, function () {
  this.timeout(30000);

  let pad: PadType;
  let padId: string;
  let socket: any;

  before(async function () {
    agent = await common.init();
  });

  beforeEach(async function () {
    padId = common.randomString();
    pad = await padManager.getPad(padId, 'x\n');
    const res = await agent.get(`/p/${padId}`).expect(200);
    socket = await common.connect(res);
    const {type} = await common.handshake(socket, padId);
    assert.equal(type, 'CLIENT_VARS');
  });

  afterEach(async function () {
    if (socket != null) socket.close();
    socket = null;
    await padManager.getPad(padId).then((p: PadType) => p.remove());
  });

  const collectNewChanges = (ms: number) => {
    const revs: number[] = [];
    const onMessage = (msg: any) => {
      if (msg?.type === 'COLLABROOM' && msg?.data?.type === 'NEW_CHANGES') {
        revs.push(msg.data.newRev);
      }
    };
    socket.on('message', onMessage);
    return new Promise<number[]>((resolve) => setTimeout(() => {
      socket.off('message', onMessage);
      resolve(revs);
    }, ms));
  };

  it('sends each revision exactly once when fan-outs overlap', async function () {
    const collected = collectNewChanges(2000);
    // Append behind the client's back so the pad has a backlog to fan out, then
    // race two fan-outs. Without the guard both runs start at the same rev.
    for (const text of ['a\n', 'b\n', 'c\n']) await pad.setText(text);
    const head = pad.getHeadRevisionNumber();
    await Promise.all([
      padMessageHandler.updatePadClients(pad),
      padMessageHandler.updatePadClients(pad),
      padMessageHandler.updatePadClients(pad),
    ]);

    const revs = await collected;
    assert.deepEqual([...new Set(revs)], revs,
        `every revision must be sent once, got ${JSON.stringify(revs)}`);
    assert.deepEqual(revs, [...revs].sort((a, b) => a - b),
        `revisions must arrive in order, got ${JSON.stringify(revs)}`);
    assert.equal(revs[revs.length - 1], head, 'the client is caught up to head');
  });

  it('releases the in-flight flag so later fan-outs still deliver', async function () {
    // Collect across both fan-outs: a flag that is never cleared would deliver
    // the first revision and then go silent.
    const collected = collectNewChanges(2000);
    await pad.setText('first\n');
    await padMessageHandler.updatePadClients(pad);
    await pad.setText('second\n');
    const head = pad.getHeadRevisionNumber();
    await padMessageHandler.updatePadClients(pad);
    const revs = await collected;
    assert.deepEqual(revs, [head - 1, head],
        `both revisions must be delivered, got ${JSON.stringify(revs)}`);
  });
});
