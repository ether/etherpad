'use strict';

/**
 * Socket messages must stay bound to the pad they were authorized for.
 *
 * Every socket message is authorized against the pad the session points at when
 * the message arrives, then dispatched after several awaits (checkAccess and the
 * handleMessageSecurity/handleMessage hooks). A second CLIENT_READY on the same
 * socket used to rewrite sessioninfos[socket.id].padId/readonly IN PLACE before
 * its own access check had even run, so a message authorized for pad A was
 * dispatched against pad B — leaking chat/history of pads the user cannot open
 * and letting chat/saved revisions be written into them.
 *
 * These tests drive the real race: a message for an authorized pad is held in a
 * handleMessageSecurity hook (an await that is part of the normal pipeline)
 * while a CLIENT_READY for another pad is processed on the same socket.
 */

import {MapArrayType} from '../../../node/types/MapType';
import readOnlyManager from '../../../node/db/ReadOnlyManager';

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const groupManager = require('../../../node/db/GroupManager');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import padutils from '../../../static/js/pad_utils';
import ChatMessage from '../../../static/js/ChatMessage';

const SECRET = 'TOP-SECRET-victim-content';
const brief = (x: any) => JSON.stringify(x).slice(0, 400);

describe(__filename, function () {
  this.timeout(30000);
  let agent: any;
  const backups: MapArrayType<any> = {};
  const cleanup: Array<() => Promise<void>> = [];

  before(async function () { agent = await common.init(); });

  beforeEach(function () {
    backups.hooks = {handleMessageSecurity: plugins.hooks.handleMessageSecurity};
    plugins.hooks.handleMessageSecurity = [];
  });
  afterEach(async function () {
    Object.assign(plugins.hooks, backups.hooks);
    while (cleanup.length) await cleanup.pop()!();
  });

  // Hold the first message matching `match` for a while, giving a concurrent
  // CLIENT_READY time to run its pre-processing and access check.
  // Resolves once the held message is parked inside the hook (i.e. it has
  // already been authorized and pinned), so the raced CLIENT_READY is sent at
  // exactly the point a slow hook / DB call would expose.
  const holdFirst = (match: (msg: any) => boolean, ms = 300) => {
    let held = false;
    let entered: () => void;
    const enteredP = new Promise<void>((r) => { entered = r; });
    plugins.hooks.handleMessageSecurity = [{
      hook_fn: async (hookName: string, ctx: any) => {
        if (held || !match(ctx.message)) return;
        held = true;
        entered();
        await new Promise((r) => setTimeout(r, ms));
      },
      hook_fn_name: 'toctou/handleMessageSecurity',
      hook_name: 'handleMessageSecurity',
      part: {plugin: 'toctou'},
    }];
    return enteredP;
  };

  const collect = (socket: any) => {
    const msgs: any[] = [];
    socket.on('message', (m: any) => msgs.push(m));
    return msgs;
  };

  const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));

  // Polls until pred() is true, so tests assert on the observable result of
  // the held message instead of only on a fixed delay.
  const waitFor = async (pred: () => boolean | Promise<boolean>, what: string,
      timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (!(await pred())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  const makePublicPad = async () => {
    const id = `toctou_pub_${common.randomString()}`;
    const pad = await padManager.getPad(id, 'public text\n');
    cleanup.push(async () => { await pad.remove(); });
    return {id, pad};
  };

  // A private group pad: a plain author token gets accessStatus "deny".
  const makePrivatePad = async () => {
    const {groupID} = await groupManager.createGroup();
    const {padID: id} = await groupManager.createGroupPad(groupID, 'victim', `${SECRET}\n`);
    const pad = await padManager.getPad(id);
    await pad.appendChatMessage(new ChatMessage(SECRET, 'a.victim', Date.now()));
    cleanup.push(async () => { await groupManager.deleteGroup(groupID); });
    return {id, pad};
  };

  const clientReady = (socket: any, padId: string, token: string) => socket.emit('message', {
    component: 'pad',
    type: 'CLIENT_READY',
    padId,
    sessionID: null,
    token,
  });

  const collab = (socket: any, data: any) => socket.emit('message', {
    type: 'COLLABROOM', component: 'pad', data,
  });

  // Joins public pad A, returns the socket plus a token reused for the raced
  // CLIENT_READY (so the author check doesn't short-circuit the race).
  const joinPublic = async () => {
    const a = await makePublicPad();
    const token = padutils.generateAuthorToken();
    const res = await agent.get(`/p/${a.id}`).expect(200);
    const socket = await common.connect(res);
    cleanup.push(async () => { socket.close(); });
    const {type, data} = await common.handshake(socket, a.id, token);
    assert.equal(type, 'CLIENT_VARS');
    return {a, socket, token, clientVars: data};
  };

  it('sanity: a private group pad denies a direct CLIENT_READY', async function () {
    const b = await makePrivatePad();
    const res = await agent.get('/p/whatever').expect(200);
    const socket = await common.connect(res);
    cleanup.push(async () => { socket.close(); });
    const msg = await common.handshake(socket, b.id);
    assert.deepEqual(msg, {accessStatus: 'deny'});
  });

  it('GET_CHAT_MESSAGES cannot be retargeted to an unauthorized pad', async function () {
    const {socket, token} = await joinPublic();
    const b = await makePrivatePad();
    const msgs = collect(socket);
    const held = holdFirst((m) => m?.data?.type === 'GET_CHAT_MESSAGES');
    collab(socket, {type: 'GET_CHAT_MESSAGES', start: 0, end: 10});
    await held;
    clientReady(socket, b.id, token);
    await waitFor(() => msgs.some((m) => m?.data?.type === 'CHAT_MESSAGES'),
        'the chat history reply for the authorized pad');
    await settle();
    assert(!JSON.stringify(msgs).includes(SECRET),
        `victim chat leaked: ${brief(msgs)}`);
  });

  it('CHANGESET_REQ cannot be retargeted to an unauthorized pad', async function () {
    const {socket, token} = await joinPublic();
    const b = await makePrivatePad();
    const msgs = collect(socket);
    const held = holdFirst((m) => m?.type === 'CHANGESET_REQ');
    socket.emit('message', {
      type: 'CHANGESET_REQ', component: 'pad',
      data: {granularity: 1, start: 0, requestID: 'r1'},
    });
    await held;
    clientReady(socket, b.id, token);
    await waitFor(() => msgs.some(
        (m) => m?.type === 'CHANGESET_REQ' && m?.data?.requestID === 'r1'),
    'the changeset reply for the authorized pad');
    await settle();
    assert(!JSON.stringify(msgs).includes(SECRET),
        `victim history leaked: ${brief(msgs)}`);
  });

  it('CHAT_MESSAGE cannot be retargeted into an unauthorized pad', async function () {
    const {a, socket, token} = await joinPublic();
    const b = await makePrivatePad();
    const held = holdFirst((m) => m?.data?.type === 'CHAT_MESSAGE');
    collab(socket, {type: 'CHAT_MESSAGE', message: {text: 'injected'}});
    await held;
    clientReady(socket, b.id, token);
    await settle();
    const victim = await padManager.getPad(b.id);
    assert.equal(victim.chatHead, 0, 'victim pad must not receive the chat message');
    const own = await padManager.getPad(a.id);
    assert.equal(own.chatHead, 0, 'the chat message lands on the authorized pad');
  });

  it('CHAT_MESSAGE cannot bypass the read-only gate via a read-only CLIENT_READY',
      async function () {
        const {a, socket, token} = await joinPublic();
        // Pad C: the attacker legitimately holds only its read-only ID.
        const cId = `toctou_ro_${common.randomString()}`;
        const c = await padManager.getPad(cId, 'ro text\n');
        cleanup.push(async () => { await c.remove(); });
        const roId = await readOnlyManager.getReadOnlyId(cId);
        const held = holdFirst((m) => m?.data?.type === 'CHAT_MESSAGE');
        collab(socket, {type: 'CHAT_MESSAGE', message: {text: 'injected'}});
        await held;
        clientReady(socket, roId, token);
        await settle();
        assert.equal((await padManager.getPad(cId)).chatHead, -1,
            'read-only pad must not receive the chat message');
        assert.equal((await padManager.getPad(a.id)).chatHead, 0);
      });

  it('SAVE_REVISION cannot be retargeted into an unauthorized pad', async function () {
    const {a, socket, token} = await joinPublic();
    const b = await makePrivatePad();
    const held = holdFirst((m) => m?.data?.type === 'SAVE_REVISION');
    collab(socket, {type: 'SAVE_REVISION'});
    await held;
    clientReady(socket, b.id, token);
    await waitFor(async () => (await padManager.getPad(a.id)).getSavedRevisions().length === 1,
        'the saved revision on the authorized pad');
    await settle();
    const victim = await padManager.getPad(b.id);
    assert.equal(victim.getSavedRevisions().length, 0,
        'victim pad must not gain a saved revision');
  });

  it('a raced CLIENT_READY cannot load an unauthorized pad', async function () {
    const a = await makePublicPad();
    const b = await makePrivatePad();
    const token = padutils.generateAuthorToken();
    const res = await agent.get(`/p/${a.id}`).expect(200);
    const socket = await common.connect(res);
    cleanup.push(async () => { socket.close(); });
    const msgs = collect(socket);
    const held = holdFirst((m) => m?.type === 'CLIENT_READY');
    clientReady(socket, a.id, token);
    await held;
    clientReady(socket, b.id, token);
    await settle();
    assert(!JSON.stringify(msgs).includes(SECRET),
        `victim pad content leaked: ${brief(msgs)}`);
    const vars = msgs.find((m) => m.type === 'CLIENT_VARS');
    assert(vars, `expected CLIENT_VARS for the authorized pad: ${brief(msgs)}`);
    assert.equal(vars.data.padId, a.id);
  });
});
