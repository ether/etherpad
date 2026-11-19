'use strict';

// GHSA-w4w9-j4c3-hjf6: an unauthenticated client could store an author name of up to ~1 MB
// (bounded only by engine.io's maxHttpBufferSize) via CLIENT_READY or USERINFO_UPDATE, and the
// server rebroadcast it to every client that opened the pad.

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const authorManager = require('../../../node/db/AuthorManager');
const DB = require('../../../node/db/DB');
const padutils = require('../../../static/js/pad_utils').default;

const {MAX_AUTHOR_NAME_LENGTH, sanitizeAuthorName} = authorManager;
// Large enough to prove the cap, small enough to stay well under the 1 MB transport limit.
const HUGE = 200000;

const waitForMessage = (socket: any, pred: (msg: any) => boolean, timeoutMs = 5000) =>
  new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMsg);
      reject(new Error('timed out waiting for matching message'));
    }, timeoutMs);
    const onMsg = (msg: any) => {
      if (!pred(msg)) return;
      clearTimeout(timer);
      socket.off('message', onMsg);
      resolve(msg);
    };
    socket.on('message', onMsg);
  });

describe(__filename, function () {
  let agent: any;
  let padId: string;
  const sockets: any[] = [];

  const join = async (userInfo?: any) => {
    const res = await agent.get(`/p/${padId}`).expect(200);
    const socket = await common.connect(res);
    sockets.push(socket);
    const msgP = waitForMessage(socket, (m) => m.type === 'CLIENT_VARS' || m.accessStatus);
    socket.emit('message', {
      component: 'pad',
      type: 'CLIENT_READY',
      padId,
      sessionID: null,
      token: padutils.generateAuthorToken(),
      ...(userInfo === undefined ? {} : {userInfo}),
    });
    const msg = await msgP;
    assert.equal(msg.type, 'CLIENT_VARS');
    return {socket, clientVars: msg.data};
  };

  before(async function () {
    agent = await common.init();
  });

  beforeEach(async function () {
    padId = common.randomString();
    assert(!await padManager.doesPadExist(padId));
  });

  afterEach(async function () {
    while (sockets.length) sockets.pop().close();
    if (await padManager.doesPadExist(padId)) await padManager.removePad(padId);
  });

  describe('sanitizeAuthorName', function () {
    it('keeps a normal name', function () {
      assert.equal(sanitizeAuthorName('Alice'), 'Alice');
    });
    it('trims whitespace', function () {
      assert.equal(sanitizeAuthorName('  Alice  '), 'Alice');
    });
    it('caps an oversized name', function () {
      assert.equal(sanitizeAuthorName('A'.repeat(HUGE)), 'A'.repeat(MAX_AUTHOR_NAME_LENGTH));
    });
    it('caps after leading whitespace', function () {
      assert.equal(sanitizeAuthorName(`${' '.repeat(1000)}${'B'.repeat(HUGE)}`),
          'B'.repeat(MAX_AUTHOR_NAME_LENGTH));
    });
    it('does not split a surrogate pair', function () {
      const out = sanitizeAuthorName('\u{1F600}'.repeat(500));
      assert.equal(Array.from(out).length, MAX_AUTHOR_NAME_LENGTH);
      assert.equal(out, '\u{1F600}'.repeat(MAX_AUTHOR_NAME_LENGTH));
    });
    for (const v of [null, undefined, 42, true, {}, ['a'], {toString: () => 'x'}, '', '   ']) {
      it(`returns null for ${JSON.stringify(v)}`, function () {
        assert.equal(sanitizeAuthorName(v), null);
      });
    }
  });

  describe('CLIENT_READY', function () {
    it('stores a normal name unchanged', async function () {
      const {clientVars} = await join({name: 'Alice', colorId: '#ff0000'});
      assert.equal(clientVars.userName, 'Alice');
      assert.equal(await authorManager.getAuthorName(clientVars.userId), 'Alice');
    });

    it('truncates an oversized name before storing it', async function () {
      const {clientVars} = await join({name: 'A'.repeat(HUGE), colorId: '#ff0000'});
      assert.equal(clientVars.userName, 'A'.repeat(MAX_AUTHOR_NAME_LENGTH));
      const record = await DB.db.get(`globalAuthor:${clientVars.userId}`);
      assert.equal(record.name.length, MAX_AUTHOR_NAME_LENGTH);
    });

    it('does not store a non-string name', async function () {
      const {clientVars} = await join({name: {x: 'A'.repeat(1000)}, colorId: '#ff0000'});
      assert.equal(clientVars.userName, undefined);
      const record = await DB.db.get(`globalAuthor:${clientVars.userId}`);
      assert(record.name == null, `expected no name, got ${JSON.stringify(record.name)}`);
    });

    it('a second client never receives an oversized name', async function () {
      const first = await join({name: 'A'.repeat(HUGE), colorId: '#ff0000'});
      const second = await join();
      const hist = second.clientVars.collab_client_vars.historicalAuthorData;
      // The first author has not edited yet, so it may not be in the pool; if it is, it is capped.
      const entry = hist[first.clientVars.userId];
      if (entry) assert.equal(entry.name.length, MAX_AUTHOR_NAME_LENGTH);
      assert(JSON.stringify(second.clientVars).length < HUGE);
    });
  });

  describe('USERINFO_UPDATE', function () {
    const update = async (socket: any, name: any) => await common.sendMessage(socket, {
      type: 'COLLABROOM',
      component: 'pad',
      data: {type: 'USERINFO_UPDATE', userInfo: {name, colorId: '#00ff00'}},
    });

    it('caps an oversized name in storage and in USER_NEWINFO', async function () {
      const a = await join();
      const b = await join();
      const newInfoP = waitForMessage(b.socket, (m) => m.type === 'COLLABROOM' &&
          m.data.type === 'USER_NEWINFO' && m.data.userInfo.userId === a.clientVars.userId &&
          m.data.userInfo.colorId === '#00ff00');
      await update(a.socket, 'B'.repeat(HUGE));
      const msg = await newInfoP;
      assert.equal(msg.data.userInfo.name, 'B'.repeat(MAX_AUTHOR_NAME_LENGTH));
      const record = await DB.db.get(`globalAuthor:${a.clientVars.userId}`);
      assert.equal(record.name, 'B'.repeat(MAX_AUTHOR_NAME_LENGTH));
    });

    it('drops a non-string name', async function () {
      const a = await join({name: 'Alice', colorId: '#ff0000'});
      const b = await join();
      const newInfoP = waitForMessage(b.socket, (m) => m.type === 'COLLABROOM' &&
          m.data.type === 'USER_NEWINFO' && m.data.userInfo.userId === a.clientVars.userId &&
          m.data.userInfo.colorId === '#00ff00');
      await update(a.socket, ['B'.repeat(1000)]);
      const msg = await newInfoP;
      assert.equal(msg.data.userInfo.name, null);
      assert((await DB.db.get(`globalAuthor:${a.clientVars.userId}`)).name == null);
    });

    it('keeps a normal name', async function () {
      const a = await join();
      await update(a.socket, '  Bob ');
      assert.equal(await authorManager.getAuthorName(a.clientVars.userId), 'Bob');
    });
  });

  describe('existing oversized DB record', function () {
    it('is capped in historicalAuthorData, USER_NEWINFO and getAuthorName', async function () {
      // Simulate a record stored before the cap existed, for an author in the pad's pool.
      const {authorID} = await authorManager.createAuthor(null);
      const record = await DB.db.get(`globalAuthor:${authorID}`);
      await DB.db.set(`globalAuthor:${authorID}`, {...record, name: 'C'.repeat(HUGE)});
      const pad = await padManager.getPad(padId, 'hello\n', authorID);
      assert(pad.getAllAuthors().includes(authorID));

      const {clientVars} = await join();
      const entry = clientVars.collab_client_vars.historicalAuthorData[authorID];
      assert(entry != null);
      assert.equal(entry.name, 'C'.repeat(MAX_AUTHOR_NAME_LENGTH));
      assert(JSON.stringify(clientVars).length < HUGE);
      assert.equal(await authorManager.getAuthorName(authorID), 'C'.repeat(MAX_AUTHOR_NAME_LENGTH));
    });

    it('a non-string name does not break admin author search', async function () {
      const {authorID} = await authorManager.createAuthor(null);
      const record = await DB.db.get(`globalAuthor:${authorID}`);
      await DB.db.set(`globalAuthor:${authorID}`, {...record, name: {x: 'y'}});
      const res = await authorManager.searchAuthors({
        pattern: authorID.slice(2), offset: 0, limit: 12, sortBy: 'name', ascending: true,
        includeErased: false,
      });
      const row = res.results.find((r: any) => r.authorID === authorID);
      assert(row != null);
      assert.equal(row.name, null);
    });

    it('is capped in the joining client\'s own clientVars and USER_NEWINFO', async function () {
      const observer = await join();
      // Join once to get an author/token, then inflate the stored name and rejoin with the
      // same token (no userInfo, so the stored name is what gets read back).
      const token = padutils.generateAuthorToken();
      const res = await agent.get(`/p/${padId}`).expect(200);
      const s1 = await common.connect(res);
      sockets.push(s1);
      const cv1P = waitForMessage(s1, (m) => m.type === 'CLIENT_VARS');
      s1.emit('message', {component: 'pad', type: 'CLIENT_READY', padId, sessionID: null, token});
      const authorID = (await cv1P).data.userId;
      s1.close();
      const record = await DB.db.get(`globalAuthor:${authorID}`);
      await DB.db.set(`globalAuthor:${authorID}`, {...record, name: 'D'.repeat(HUGE)});

      const newInfoP = waitForMessage(observer.socket, (m) => m.type === 'COLLABROOM' &&
          m.data.type === 'USER_NEWINFO' && m.data.userInfo.userId === authorID &&
          m.data.userInfo.name != null);
      const s2 = await common.connect(res);
      sockets.push(s2);
      const cv2P = waitForMessage(s2, (m) => m.type === 'CLIENT_VARS');
      s2.emit('message', {component: 'pad', type: 'CLIENT_READY', padId, sessionID: null, token});
      const cv2 = (await cv2P).data;
      assert.equal(cv2.userId, authorID);
      assert.equal(cv2.userName, 'D'.repeat(MAX_AUTHOR_NAME_LENGTH));
      const msg = await newInfoP;
      assert.equal(msg.data.userInfo.name, 'D'.repeat(MAX_AUTHOR_NAME_LENGTH));
    });
  });
});
