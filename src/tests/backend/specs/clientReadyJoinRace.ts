'use strict';

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const authorManager = require('../../../node/db/AuthorManager');
const groupManager = require('../../../node/db/GroupManager');
const securityManager = require('../../../node/db/SecurityManager');
const handler = require('../../../node/handler/PadMessageHandler');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import padutils from '../../../static/js/pad_utils';

// Hold real hooks/DB calls until the competing request has been acknowledged.
// No delay determines which CLIENT_READY wins the race.
describe(__filename, function () {
  this.timeout(20000);
  let agent: any;
  const cleanup: Array<() => void | Promise<void>> = [];
  const releases: Array<() => void> = [];
  const inFlight: Promise<void>[] = [];
  const servers = new Map<string, any>();

  before(async function () { agent = await common.init(); });

  const addHook = (name: string, fn: (context: any) => unknown) => {
    const original = plugins.hooks[name];
    plugins.hooks[name] = [...(original || []), {
      hook_fn: async (_name: string, context: any) => await fn(context),
      hook_fn_name: `joinRace/${name}`,
      hook_name: name,
      part: {plugin: 'joinRace'},
    }];
    cleanup.push(() => { plugins.hooks[name] = original; });
  };

  beforeEach(function () {
    addHook('handleMessageSecurity', ({socket}) => { servers.set(socket.id, socket); });
  });

  afterEach(async function () {
    for (const release of releases.splice(0)) release();
    await Promise.allSettled(inFlight.splice(0));
    while (cleanup.length) await cleanup.pop()!();
    servers.clear();
  });

  const gate = () => {
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    releases.push(release);
    let held = false;
    return {
      reached,
      release,
      hold: async () => {
        if (held) return;
        held = true;
        entered();
        await waiting;
      },
    };
  };

  const holdHook = (name: string, matches: (context: any) => boolean) => {
    const held = gate();
    addHook(name, async (context) => { if (matches(context)) await held.hold(); });
    return held;
  };

  const holdCall = (
      object: any, name: string, matches: (...args: any[]) => boolean = () => true) => {
    const original = object[name];
    const held = gate();
    object[name] = async function (...args: any[]) {
      const result = await original.apply(this, args);
      if (matches(...args)) await held.hold();
      return result;
    };
    cleanup.push(() => { object[name] = original; });
    return held;
  };

  const makePad = async () => {
    const id = `join_race_${common.randomString()}`;
    const pad = await padManager.getPad(id, `${id}\n`);
    cleanup.push(async () => { await pad.remove(); });
    return {id, pad};
  };

  const connect = async (id: string) => {
    const token = padutils.generateAuthorToken();
    // Make author creation independent of the two concurrent access checks.
    await authorManager.getAuthor4Token(token);
    const socket = await common.connect(await agent.get(`/p/${id}`).expect(200));
    cleanup.push(() => { socket.close(); });
    const messages: any[] = [];
    socket.on('message', (message: any) => messages.push(message));
    const ready = (padId: string, extra: object = {}) => {
      const done = common.sendMessage(socket, {
        component: 'pad', type: 'CLIENT_READY', padId, sessionID: null, token, ...extra,
      });
      inFlight.push(done);
      // Assertions below still await the original promise; avoid an orphan rejection on failure.
      done.catch(() => {});
      return done;
    };
    return {socket, messages, ready};
  };

  const assertJoined = async (client: any, target: any, excluded: string[] = []) => {
    const session = handler.sessioninfos[client.socket.id];
    assert.equal(session.padId, target.id);
    assert.equal(session.rev, target.pad.getHeadRevisionNumber());
    assert.equal(session.time, await target.pad.getRevisionDate(session.rev));
    const rooms = servers.get(client.socket.id).rooms;
    assert(rooms.has(target.id), 'socket must join the current pad');
    for (const id of excluded) assert(!rooms.has(id), `socket must leave ${id}`);
  };

  for (const hook of ['handleMessageSecurity', 'clientReady', 'clientVars']) {
    it(`drops a join superseded while awaiting ${hook}`, async function () {
      const a = await makePad();
      const b = await makePad();
      await b.pad.setText('a different revision\n');
      const client = await connect(a.id);
      const held = holdHook(hook, () => true);
      const first = client.ready(a.id);
      await held.reached;
      await client.ready(b.id);
      held.release();
      await first;
      assert.deepEqual(client.messages.filter((m: any) => m.type === 'CLIENT_VARS')
          .map((m: any) => m.data.padId), [b.id]);
      await assertJoined(client, b, [a.id]);
    });
  }

  it('does not let an earlier access check replace a later authorized join', async function () {
    const a = await makePad();
    const b = await makePad();
    const client = await connect(a.id);
    const held = holdCall(securityManager, 'checkAccess', (id) => id === a.id);
    const first = client.ready(a.id);
    await held.reached;
    await client.ready(b.id);
    held.release();
    await first;
    assert.deepEqual(client.messages.filter((m: any) => m.type === 'CLIENT_VARS')
        .map((m: any) => m.data.padId), [b.id]);
    await assertJoined(client, b, [a.id]);
  });

  it('keeps an authorized join when the later request is denied', async function () {
    const a = await makePad();
    const {groupID} = await groupManager.createGroup();
    cleanup.push(async () => { await groupManager.deleteGroup(groupID); });
    const {padID} = await groupManager.createGroupPad(groupID, 'private', 'private\n');
    const client = await connect(a.id);
    const held = holdHook('clientVars', () => true);
    const first = client.ready(a.id);
    await held.reached;
    await assert.rejects(client.ready(padID), /access denied/);
    held.release();
    await first;
    assert.deepEqual(client.messages.filter((m: any) => m.type === 'CLIENT_VARS')
        .map((m: any) => m.data.padId), [a.id]);
    await assertJoined(client, a, [padID]);
  });

  it('keeps the latest snapshot when two joins target the same pad', async function () {
    const a = await makePad();
    const client = await connect(a.id);
    const held = holdHook('clientVars', () => true);
    const first = client.ready(a.id);
    await held.reached;
    await a.pad.setText('new snapshot\n');
    await client.ready(a.id);
    held.release();
    await first;
    const vars = client.messages.filter((m: any) => m.type === 'CLIENT_VARS');
    assert.equal(vars.length, 1);
    assert.equal(vars[0].data.collab_client_vars.initialAttributedText.text, 'new snapshot\n');
    await assertJoined(client, a);
  });

  it('does not overwrite the current revision time after an old timestamp read', async function () {
    const a = await makePad();
    const b = await makePad();
    const client = await connect(a.id);
    let varsBuilt = false;
    addHook('clientVars', ({pad}) => { if (pad.id === a.id) varsBuilt = true; });
    const held = holdCall(a.pad, 'getRevisionDate', () => varsBuilt);
    const first = client.ready(a.id);
    await held.reached;
    await client.ready(b.id);
    const latest = {...handler.sessioninfos[client.socket.id]};
    const count = client.messages.length;
    held.release();
    await first;
    assert.equal(handler.sessioninfos[client.socket.id].time, latest.time);
    assert.equal(client.messages.length, count, 'the old join must not emit after the new join');
    await assertJoined(client, b, [a.id]);
  });

  it('drops reconnect revisions after another pad has been joined', async function () {
    const a = await makePad();
    const b = await makePad();
    await a.pad.setText('a missed revision\n');
    const client = await connect(a.id);
    const held = holdCall(a.pad, 'getRevisionChangeset');
    const first = client.ready(a.id, {reconnect: true, client_rev: 0});
    await held.reached;
    await client.ready(b.id);
    held.release();
    await first;
    assert(!client.messages.some((m: any) => m.data?.type === 'CLIENT_RECONNECT'));
    await assertJoined(client, b, [a.id]);
  });

  it('leaves the previous room and notifies its remaining users on a sequential join',
      async function () {
        const a = await makePad();
        const b = await makePad();
        const observer = await connect(a.id);
        await observer.ready(a.id);
        const client = await connect(a.id);
        await client.ready(a.id);
        const author = handler.sessioninfos[client.socket.id].author;
        const left: string[] = [];
        addHook('userLeave', ({padId}) => { left.push(padId); });
        // The observer's own acknowledgement flushes earlier room notifications.
        await client.ready(b.id);
        await common.sendMessage(observer.socket, {
          component: 'pad', type: 'COLLABROOM', data: {type: 'GET_CHAT_MESSAGES', start: 0, end: 0},
        });
        assert(observer.messages.some((m: any) => (
          m.data?.type === 'USER_LEAVE' && m.data.userInfo.userId === author)));
        assert.deepEqual(left, [a.id]);
        await assertJoined(client, b, [a.id]);
      });

  it('preserves presence when another authenticated socket has the same author', async function () {
    const a = await makePad();
    const b = await makePad();
    const author = await authorManager.getAuthor4Token(padutils.generateAuthorToken());
    addHook('getAuthorId', () => author);
    addHook('handleMessageSecurity', ({socket}) => {
      socket.client.request.session.user = {username: 'join-race'};
    });
    const observer = await connect(a.id);
    await observer.ready(a.id);
    const client = await connect(a.id);
    await client.ready(a.id);
    assert.equal(handler.sessioninfos[observer.socket.id].author,
        handler.sessioninfos[client.socket.id].author);
    const left: string[] = [];
    addHook('userLeave', ({padId}) => { left.push(padId); });
    await client.ready(b.id);
    await common.sendMessage(observer.socket, {
      component: 'pad', type: 'COLLABROOM', data: {type: 'GET_CHAT_MESSAGES', start: 0, end: 0},
    });
    assert(!observer.messages.some((m: any) => m.data?.type === 'USER_LEAVE'));
    assert.deepEqual(left, []);
    await assertJoined(client, b, [a.id]);
  });

  it('drops a join superseded while notifying the previous room', async function () {
    const a = await makePad();
    const b = await makePad();
    const c = await makePad();
    const client = await connect(a.id);
    await client.ready(a.id);
    const held = holdHook('userLeave', ({padId}) => padId === a.id);
    const second = client.ready(b.id);
    await held.reached;
    await client.ready(c.id);
    held.release();
    await second;
    assert.deepEqual(client.messages.filter((m: any) => m.type === 'CLIENT_VARS')
        .map((m: any) => m.data.padId), [a.id, c.id]);
    await assertJoined(client, c, [a.id, b.id]);
  });

  it('does not finish joining after a disconnect during clientVars', async function () {
    const a = await makePad();
    const b = await makePad();
    await b.pad.setText('a later revision\n');
    const client = await connect(a.id);
    await client.ready(a.id);
    const session = handler.sessioninfos[client.socket.id];
    const previousRev = session.rev;
    const joined: string[] = [];
    addHook('userJoin', ({padId}) => { joined.push(padId); });
    const held = holdHook('clientVars', ({pad}) => pad.id === b.id);
    const server = servers.get(client.socket.id);
    // Invoke the real handler directly so completion remains observable after socket disconnect.
    const pending = handler.handleMessage(server, {
      component: 'pad', type: 'CLIENT_READY', padId: b.id,
      sessionID: null, token: session.auth.token,
    });
    inFlight.push(pending);
    await held.reached;
    server.disconnect(true);
    held.release();
    await pending;
    assert.equal(session.rev, previousRev, 'disconnected session must not receive a new baseline');
    assert.deepEqual(joined, []);
  });

  for (const samePad of [false, true]) {
    it(`drops an in-flight revision update after joining ${samePad ? 'the same' : 'another'} pad`,
        async function () {
          const a = await makePad();
          const b = samePad ? a : await makePad();
          const client = await connect(a.id);
          await client.ready(a.id);
          await a.pad.setText('pending change\n');
          const held = holdCall(a.pad, 'getRevision');
          const update = handler.updatePadClients(a.pad);
          inFlight.push(update);
          await held.reached;
          await client.ready(b.id);
          held.release();
          await update;
          // Flush socket writes made by the direct updatePadClients() call.
          await common.sendMessage(client.socket, {
            component: 'pad', type: 'COLLABROOM',
            data: {type: 'GET_CHAT_MESSAGES', start: 0, end: 0},
          });
          assert(!client.messages.some((m: any) => m.data?.type === 'NEW_CHANGES'));
          await assertJoined(client, b, samePad ? [] : [a.id]);
        });
  }
});
