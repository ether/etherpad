'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';

/**
 * Tests for https://github.com/ether/etherpad-lite/issues/2802
 *
 * When User B clears authorship colors (removing all author attributes) and then undoes,
 * the undo changeset re-applies author attributes for ALL authors (A and B). The server
 * rejects this because User B is submitting changes containing User A's author ID, causing
 * a disconnect with "badChangeset".
 *
 * The server should allow undo of clear authorship without disconnecting the user.
 */

import {PadType} from "../../../node/types/PadType.js";

import assert from 'assert';
import * as common from '../common.js';
import * as padManager from '../../../node/db/PadManager.js';
import AttributePool from '../../../static/js/AttributePool.js';
import padutils from '../../../static/js/pad_utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe(__filename, function () {
  let agent: any;
  let pad: PadType | null;
  let padId: string;
  let socketA: any;
  let socketB: any;
  let revA: number;
  let revB: number;

  before(async function () {
    agent = await common.init();
  });

  beforeEach(async function () {
    padId = common.randomString();
    assert(!await padManager.doesPadExist(padId));
    pad = await padManager.getPad(padId, '');
    await pad!.setText('\n');
    assert.equal(pad!.text(), '\n');
  });

  afterEach(async function () {
    if (socketA != null) socketA.close();
    socketA = null;
    if (socketB != null) socketB.close();
    socketB = null;
    if (pad != null) await pad.remove();
    pad = null;
  });

  /**
   * Connect a user to the pad with a unique author token.
   */
  const connectUser = async () => {
    const res = await agent.get(`/p/${padId}`).expect(200);
    const socket = await common.connect(res);
    const token = padutils.generateAuthorToken();
    const {type, data: clientVars} = await common.handshake(socket, padId, token);
    assert.equal(type, 'CLIENT_VARS');
    const rev = clientVars.collab_client_vars.rev;
    const author = clientVars.userId;
    return {socket, rev, author};
  };

  const sendUserChanges = async (socket: any, baseRev: number, changeset: string, apool?: any) => {
    await common.sendUserChanges(socket, {
      baseRev,
      changeset,
      ...(apool ? {apool} : {}),
    });
  };

  /**
   * Wait for an ACCEPT_COMMIT or disconnect message, ignoring other messages.
   * Uses a single persistent listener to avoid missing messages between on/off cycles.
   */
  const waitForCommitOrDisconnect = (socket: any, timeoutMs = 10000): Promise<any> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off('message', handler);
        reject(new Error(`timed out waiting for ACCEPT_COMMIT or disconnect after ${timeoutMs}ms`));
      }, timeoutMs);
      const handler = (msg: any) => {
        if (msg.disconnect) {
          clearTimeout(timeout);
          socket.off('message', handler);
          resolve(msg);
        } else if (msg.type === 'COLLABROOM' && msg.data?.type === 'ACCEPT_COMMIT') {
          clearTimeout(timeout);
          socket.off('message', handler);
          resolve(msg);
        }
        // Ignore USER_NEWINFO, NEW_CHANGES, etc.
      };
      socket.on('message', handler);
    });
  };

  const waitForAcceptCommit = async (socket: any, wantRev: number) => {
    const msg = await waitForCommitOrDisconnect(socket);
    if (msg.disconnect) {
      throw new Error(`Unexpected disconnect: ${JSON.stringify(msg)}`);
    }
    assert.equal(msg.data.newRev, wantRev);
  };

  /**
   * Wait for a specific message type, ignoring others. Used for cross-user sync.
   */
  const waitForNewChanges = (socket: any, timeoutMs = 10000): Promise<void> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off('message', handler);
        reject(new Error(`timed out waiting for NEW_CHANGES after ${timeoutMs}ms`));
      }, timeoutMs);
      const handler = (msg: any) => {
        if (msg.type === 'COLLABROOM' && msg.data?.type === 'NEW_CHANGES') {
          clearTimeout(timeout);
          socket.off('message', handler);
          resolve();
        }
      };
      socket.on('message', handler);
    });
  };

  describe('undo of clear authorship colors (bug #2802)', function () {
    it('should not disconnect when undoing clear authorship with multiple authors', async function () {

      // Step 1: Connect User A
      const userA = await connectUser();
      socketA = userA.socket;
      revA = userA.rev;

      // Step 2: User A types "hello" with their author attribute
      const apoolA = new AttributePool();
      apoolA.putAttrib(['author', userA.author]);
      await Promise.all([
        waitForAcceptCommit(socketA, revA + 1),
        sendUserChanges(socketA, revA, 'Z:1>5*0+5$hello', apoolA),
      ]);
      revA += 1;

      // Step 3: Connect User B (after User A's text is committed)
      const userB = await connectUser();
      socketB = userB.socket;
      revB = userB.rev;

      // Step 4: User B types " world" with their author attribute
      const apoolB = new AttributePool();
      apoolB.putAttrib(['author', userB.author]);
      const userASeesB = waitForNewChanges(socketA);
      await Promise.all([
        waitForAcceptCommit(socketB, revB + 1),
        sendUserChanges(socketB, revB, 'Z:6>6=5*0+6$ world', apoolB),
      ]);
      revB += 1;

      // Wait for User A to see User B's change
      await userASeesB;
      revA = revB;

      // The pad now has "hello world\n" with two different authors
      assert.equal(pad!.text(), 'hello world\n');

      // Step 5: User B clears authorship colors (sets author to '' on all text)
      const clearPool = new AttributePool();
      clearPool.putAttrib(['author', '']);
      await Promise.all([
        waitForAcceptCommit(socketB, revB + 1),
        sendUserChanges(socketB, revB, 'Z:c>0*0=b$', clearPool),
      ]);
      revB += 1;

      // Step 6: User B undoes the clear authorship
      // This is the critical part - the undo changeset re-applies the original
      // author attributes, which include User A's author ID.
      const undoPool = new AttributePool();
      undoPool.putAttrib(['author', userA.author]); // 0 = author A
      undoPool.putAttrib(['author', userB.author]); // 1 = author B
      // Undo restores: "hello" with author A (5 chars), " world" with author B (6 chars)
      const undoChangeset = 'Z:c>0*0=5*1=6$';

      // This should NOT disconnect User B - that's the bug (#2802)
      const resultP = waitForCommitOrDisconnect(socketB);
      await sendUserChanges(socketB, revB, undoChangeset, undoPool);
      const msg = await resultP;

      assert.notDeepEqual(msg, {disconnect: 'badChangeset'},
          'User was disconnected with badChangeset - bug #2802');
      assert.equal(msg.type, 'COLLABROOM');
      assert.equal(msg.data.type, 'ACCEPT_COMMIT');
    });

    it('should allow clear authorship changeset with empty author from any user', async function () {
      // Connect one user, write text, then clear authorship
      const userA = await connectUser();
      socketA = userA.socket;
      revA = userA.rev;

      // User A types text
      const apoolA = new AttributePool();
      apoolA.putAttrib(['author', userA.author]);
      await Promise.all([
        waitForAcceptCommit(socketA, revA + 1),
        sendUserChanges(socketA, revA, 'Z:1>5*0+5$hello', apoolA),
      ]);
      revA += 1;

      // User A clears authorship (sets author='')
      // This should always be allowed since author='' is not impersonation
      const clearPool = new AttributePool();
      clearPool.putAttrib(['author', '']);
      await Promise.all([
        waitForAcceptCommit(socketA, revA + 1),
        sendUserChanges(socketA, revA, 'Z:6>0*0=5$', clearPool),
      ]);
    });

    it('changeset restoring own author after clear should be accepted', async function () {
      // User clears their own authorship and then undoes (restoring own author attr)
      const userA = await connectUser();
      socketA = userA.socket;
      revA = userA.rev;

      // User A types text with author attribute
      const apoolA = new AttributePool();
      apoolA.putAttrib(['author', userA.author]);
      await Promise.all([
        waitForAcceptCommit(socketA, revA + 1),
        sendUserChanges(socketA, revA, 'Z:1>5*0+5$hello', apoolA),
      ]);
      revA += 1;

      // User A clears authorship (sets author='')
      const clearPool = new AttributePool();
      clearPool.putAttrib(['author', '']);
      await Promise.all([
        waitForAcceptCommit(socketA, revA + 1),
        sendUserChanges(socketA, revA, 'Z:6>0*0=5$', clearPool),
      ]);
      revA += 1;

      // User A undoes the clear - restoring their own author attribute
      // This should be accepted since it's their own author ID
      await Promise.all([
        waitForAcceptCommit(socketA, revA + 1),
        sendUserChanges(socketA, revA, 'Z:6>0*0=5$', apoolA),
      ]);
    });

    it('changeset impersonating another author for new text should still be rejected', async function () {
      // Security: a user should NOT be able to write NEW text attributed to another author
      const userA = await connectUser();
      socketA = userA.socket;
      revA = userA.rev;

      const userB = await connectUser();
      socketB = userB.socket;
      revB = userB.rev;

      // User B tries to insert text attributed to User A - this should be rejected
      const fakePool = new AttributePool();
      fakePool.putAttrib(['author', userA.author]);

      const resultP = waitForCommitOrDisconnect(socketB);
      await sendUserChanges(socketB, revB, 'Z:1>5*0+5$hello', fakePool);
      const msg = await resultP;

      assert.deepEqual(msg, {disconnect: 'badChangeset'},
          'Should reject changeset that impersonates another author for new text');
    });

    it('should reject = op with fabricated author who never contributed to the pad', async function () {
      // Security: even for = ops, reject author IDs that don't exist in the pad's pool.
      // This prevents attributing text to users who never touched the pad.
      const userA = await connectUser();
      socketA = userA.socket;
      revA = userA.rev;

      // User A types text
      const apoolA = new AttributePool();
      apoolA.putAttrib(['author', userA.author]);
      await Promise.all([
        waitForAcceptCommit(socketA, revA + 1),
        sendUserChanges(socketA, revA, 'Z:1>5*0+5$hello', apoolA),
      ]);
      revA += 1;

      // User A tries to set a fabricated author ID on existing text via a = op
      const fakePool = new AttributePool();
      fakePool.putAttrib(['author', 'a.fabricatedAuthorId']);

      const resultP = waitForCommitOrDisconnect(socketA);
      await sendUserChanges(socketA, revA, 'Z:6>0*0=5$', fakePool);
      const msg = await resultP;

      assert.deepEqual(msg, {disconnect: 'badChangeset'},
          'Should reject = op with fabricated author not in pad pool');
    });

    it('should reject - op with foreign author to prevent pool injection', async function () {
      // Security: a '-' op with a foreign author's attribs should be rejected.
      // While '-' attribs are discarded from the document, they are added to the
      // pad's attribute pool by moveOpsToNewPool. Without this check, an attacker
      // could inject a fabricated author ID into the pool via a '-' op, then use
      // a '=' op to attribute text to that fabricated author.
      const userA = await connectUser();
      socketA = userA.socket;
      revA = userA.rev;

      // User A types text
      const apoolA = new AttributePool();
      apoolA.putAttrib(['author', userA.author]);
      await Promise.all([
        waitForAcceptCommit(socketA, revA + 1),
        sendUserChanges(socketA, revA, 'Z:1>5*0+5$hello', apoolA),
      ]);
      revA += 1;

      // User A tries to delete a char with a fabricated author attrib via a - op
      // This would inject the fabricated author into the pad pool
      const fakePool = new AttributePool();
      fakePool.putAttrib(['author', 'a.fabricatedAuthorId']);

      const resultP = waitForCommitOrDisconnect(socketA);
      // Delete 1 char with fabricated author attrib
      await sendUserChanges(socketA, revA, 'Z:6<1*0-1$', fakePool);
      const msg = await resultP;

      assert.deepEqual(msg, {disconnect: 'badChangeset'},
          'Should reject - op with fabricated author to prevent pool injection');
    });
  });
});
