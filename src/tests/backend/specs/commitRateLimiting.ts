'use strict';

/*
 * Regression coverage for commitRateLimiting.
 *
 * The limiter used to be keyed on the client IP with a 10 messages/second budget. Behind a
 * TCP-level proxy (e.g. the Home Assistant add-on's socat front-man) every browser shares one IP,
 * so a few tabs joining the same pad exhausted the budget, got {disconnect: 'rateLimited'},
 * rejoined, and kicked each other in a loop. A single client could also trip it on its own: a
 * WebRTC peer joining a pad sends a hangup, an invite, a description and one message per ICE
 * candidate per peer within ~100 ms (measured with ep_webrtc: 14 messages in 150 ms with two
 * peers). Over-limit messages, chat included, were dropped.
 *
 * All sockets in these tests come from 127.0.0.1, so they reproduce the shared-IP case.
 */

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const padMessageHandler = require('../../../node/handler/PadMessageHandler');
const settings = require('../../../node/utils/Settings');

const chat = (text: string) => ({
  type: 'COLLABROOM',
  component: 'pad',
  data: {type: 'CHAT_MESSAGE', message: {text}},
});

const watchForRateLimit = (socket: any) => {
  const state = {rateLimited: false};
  socket.on('message', (msg: any) => {
    if (msg && msg.disconnect === 'rateLimited') state.rateLimited = true;
  });
  return state;
};

describe(__filename, function () {
  let backupLimits: any;
  let backupEnv: string | undefined;
  let padId: string;
  const sockets: any[] = [];

  const join = async () => {
    const res = await common.agent!.get(`/p/${padId}`).expect(200);
    const socket = await common.connect(res);
    sockets.push(socket);
    const state = watchForRateLimit(socket);
    const {type} = await common.handshake(socket, padId);
    assert.equal(type, 'CLIENT_VARS');
    return {socket, state};
  };

  before(async function () {
    await common.init();
    backupLimits = settings.commitRateLimiting;
    backupEnv = process.env.NODE_ENV;
  });

  beforeEach(async function () {
    // The limiter only runs in production mode; enable it with the shipped defaults (common.init()
    // turns it into a no-op for the rest of the suite). The socketio hook rebuilds the limiter from
    // the current settings.
    process.env.NODE_ENV = 'production';
    settings.commitRateLimiting = {duration: 1, points: 10};
    padMessageHandler.socketio();
    padId = common.randomString();
    assert(!await padManager.doesPadExist(padId));
  });

  afterEach(async function () {
    while (sockets.length) sockets.pop().close();
    settings.commitRateLimiting = backupLimits;
    padMessageHandler.socketio();
    if (backupEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = backupEnv;
    if (await padManager.doesPadExist(padId)) await (await padManager.getPad(padId)).remove();
  });

  it('several tabs from one IP can join the same pad and chat', async function () {
    const clients = [];
    for (let i = 0; i < 4; i++) clients.push(await join());
    // 4 joins + 16 chats from one IP within a second: 20 messages, 5 per connection.
    await Promise.all(clients.flatMap(({socket}, i) =>
      [0, 1, 2, 3].map((j) => common.sendMessage(socket, chat(`tab ${i} msg ${j}`)))));
    for (const {state} of clients) assert.equal(state.rateLimited, false);
    const pad = await padManager.getPad(padId);
    assert.equal(pad.chatHead, 15, 'every chat message must be stored, none dropped');
  });

  it('a single client survives a join burst', async function () {
    const {socket, state} = await join();
    // Shape of a WebRTC join with a few peers: ~20 messages fired back to back.
    await Promise.all(Array.from({length: 20}, (_, i) => common.sendMessage(socket, chat(`m${i}`))));
    assert.equal(state.rateLimited, false);
    const pad = await padManager.getPad(padId);
    assert.equal(pad.chatHead, 19);
  });

  it('a flooding client is still disconnected', async function () {
    const {socket, state} = await join();
    const results = await Promise.allSettled(
        Array.from({length: 200}, (_, i) => common.sendMessage(socket, chat(`flood ${i}`))));
    assert(results.some((r) => r.status === 'rejected'), 'flood must hit the limiter');
    assert.equal(state.rateLimited, true);
  });

  it('a flooding client does not rate limit other clients on the same IP', async function () {
    const flooder = await join();
    const victim = await join();
    await Promise.allSettled(
        Array.from({length: 200}, (_, i) => common.sendMessage(flooder.socket, chat(`f${i}`))));
    assert.equal(flooder.state.rateLimited, true);
    await common.sendMessage(victim.socket, chat('still here'));
    assert.equal(victim.state.rateLimited, false);
  });
});
