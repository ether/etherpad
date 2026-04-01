'use strict';

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

import {PadType} from "../../../node/types/PadType";

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
import AttributePool from '../../../static/js/AttributePool';
import padutils from '../../../static/js/pad_utils';

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
   * Wait for an ACCEPT_COMMIT message, skipping any other COLLABROOM messages
   * (like USER_NEWINFO, NEW_CHANGES, etc.) that may arrive first.
   */
  const waitForAcceptCommit = async (socket: any, wantRev: number) => {
    for (;;) {
      const msg = await common.waitForSocketEvent(socket, 'message');
      if (msg.disconnect) {
        throw new Error(`Unexpected disconnect: ${JSON.stringify(msg)}`);
      }
      if (msg.type === 'COLLABROOM' && msg.data?.type === 'ACCEPT_COMMIT') {
        assert.equal(msg.data.newRev, wantRev);
        return;
      }
      // Skip non-ACCEPT_COMMIT messages (USER_NEWINFO, NEW_CHANGES, etc.)
    }
  };

  /**
   * Drain messages from a socket until we get an ACCEPT_COMMIT or disconnect.
   * Returns the message for assertion.
   */
  const waitForNextCommitOrDisconnect = async (socket: any): Promise<any> => {
    for (;;) {
      const msg = await common.waitForSocketEvent(socket, 'message');
      if (msg.disconnect) return msg;
      if (msg.type === 'COLLABROOM' && msg.data?.type === 'ACCEPT_COMMIT') return msg;
      // Skip USER_NEWINFO, NEW_CHANGES, etc.
    }
  };

  /**
   * Drain non-ACCEPT_COMMIT messages so the socket is ready for the next operation.
   * Waits briefly then consumes any queued messages.
   */
  const drainMessages = async (socket: any) => {
    await new Promise(resolve => setTimeout(resolve, 500));
  };

  describe('undo of clear authorship colors (bug #2802)', function () {
    it('should not disconnect when undoing clear authorship with multiple authors', async function () {
      this.timeout(30000);

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
      await drainMessages(socketA);
      const userB = await connectUser();
      socketB = userB.socket;
      revB = userB.rev;
      // User B joins and sees the pad at the current head revision
      await drainMessages(socketA);

      // Step 4: User B types " world" with their author attribute
      const apoolB = new AttributePool();
      apoolB.putAttrib(['author', userB.author]);
      await Promise.all([
        waitForAcceptCommit(socketB, revB + 1),
        sendUserChanges(socketB, revB, 'Z:6>6=5*0+6$ world', apoolB),
      ]);
      revB += 1;

      // Wait for User A to see the change
      await drainMessages(socketA);
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
      await drainMessages(socketA);
      revA = revB;

      // Step 6: User B undoes the clear authorship
      // This is the critical part - the undo changeset re-applies the original
      // author attributes, which include User A's author ID.
      // The server currently rejects this because User B is submitting changes
      // with User A's author ID.
      const undoPool = new AttributePool();
      undoPool.putAttrib(['author', userA.author]); // 0 = author A
      undoPool.putAttrib(['author', userB.author]); // 1 = author B
      // Undo restores: "hello" with author A (5 chars), " world" with author B (6 chars)
      const undoChangeset = 'Z:c>0*0=5*1=6$';

      // This should NOT disconnect User B - that's the bug (#2802)
      const result = await Promise.all([
        waitForNextCommitOrDisconnect(socketB),
        sendUserChanges(socketB, revB, undoChangeset, undoPool),
      ]);

      const msg = result[0];
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

      await drainMessages(socketA);

      const userB = await connectUser();
      socketB = userB.socket;
      revB = userB.rev;

      await drainMessages(socketA);

      // User B tries to insert text attributed to User A - this should be rejected
      const fakePool = new AttributePool();
      fakePool.putAttrib(['author', userA.author]);

      const result = await Promise.all([
        waitForNextCommitOrDisconnect(socketB),
        sendUserChanges(socketB, revB, 'Z:1>5*0+5$hello', fakePool),
      ]);

      assert.deepEqual(result[0], {disconnect: 'badChangeset'},
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

      const result = await Promise.all([
        waitForNextCommitOrDisconnect(socketA),
        sendUserChanges(socketA, revA, 'Z:6>0*0=5$', fakePool),
      ]);

      assert.deepEqual(result[0], {disconnect: 'badChangeset'},
          'Should reject = op with fabricated author not in pad pool');
    });
  });
});
