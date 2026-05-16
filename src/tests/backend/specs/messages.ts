'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {PadType} from "../../../node/types/PadType.js";
import {MapArrayType} from "../../../node/types/MapType.js";

import assert from 'assert';
import * as common from '../common.js';
import * as padManager from '../../../node/db/PadManager.js';
import pluginDefs from '../../../static/js/pluginfw/plugin_defs.js';
import readOnlyManager from '../../../node/db/ReadOnlyManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const plugins = pluginDefs;

describe(__filename, function () {
  let agent:any;
  let pad:PadType|null;
  let padId: string;
  let roPadId: string;
  let rev: number;
  let socket: any;
  let roSocket: any;
  const backups:MapArrayType<any> = {};

  before(async function () {
    agent = await common.init();
  });

  let authorId: string;
  let roAuthorId: string;
  beforeEach(async function () {
    backups.hooks = {handleMessageSecurity: plugins.hooks.handleMessageSecurity};
    plugins.hooks.handleMessageSecurity = [];
    padId = common.randomString();
    assert(!await padManager.doesPadExist(padId));
    pad = await padManager.getPad(padId, 'dummy text\n');
    await pad!.setText('\n'); // Make sure the pad is created.
    assert.equal(pad!.text(), '\n');
    let res = await agent.get(`/p/${padId}`).expect(200);
    socket = await common.connect(res);
    const {type, data: clientVars} = await common.handshake(socket, padId);
    assert.equal(type, 'CLIENT_VARS');
    rev = clientVars.collab_client_vars.rev;
    authorId = clientVars.userId;

    roPadId = await readOnlyManager.getReadOnlyId(padId);
    res = await agent.get(`/p/${roPadId}`).expect(200);
    roSocket = await common.connect(res);
    const roHandshake = await common.handshake(roSocket, roPadId);
    // Capture roSocket's own author so tests that send USER_CHANGES via
    // roSocket can build apools that match thisSession.author server-side;
    // otherwise the wire's *0 reference points at the writer-socket's
    // author and the server rejects with badChangeset on the
    // "author mismatch" check added in this PR.
    roAuthorId = (roHandshake as any).data.userId;
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterEach(async function () {
    Object.assign(plugins.hooks, backups.hooks);
    if (socket != null) socket.close();
    socket = null;
    if (roSocket != null) roSocket.close();
    roSocket = null;
    if (pad != null) await pad.remove();
    pad = null;
  });

  describe('CHANGESET_REQ', function () {
    it('users are unable to read changesets from other pads', async function () {
      const otherPadId = `${padId}other`;
      assert(!await padManager.doesPadExist(otherPadId));
      const otherPad = await padManager.getPad(otherPadId, 'other text\n');
      try {
        await otherPad.setText('other text\n');
        const resP = common.waitForSocketEvent(roSocket, 'message');
        await common.sendMessage(roSocket, {
          component: 'pad',
          padId: otherPadId, // The server should ignore this.
          type: 'CHANGESET_REQ',
          data: {
            granularity: 1,
            start: 0,
            requestID: 'requestId',
          },
        });
        const res = await resP;
        assert.equal(res.type, 'CHANGESET_REQ');
        assert.equal(res.data.requestID, 'requestId');
        // Should match padId's text, not otherPadId's text.
        assert.match(res.data.forwardsChangesets[0], /^[^$]*\$dummy text\n/);
      } finally {
        await otherPad.remove();
      }
    });

    it('CHANGESET_REQ: verify revNum is a number (regression)', async function () {
      const otherPadId = `${padId}other`;
      assert(!await padManager.doesPadExist(otherPadId));
      const otherPad = await padManager.getPad(otherPadId, 'other text\n');
      let errorCatched = 0;
      try {
        await otherPad.setText('other text\n');
        await common.sendMessage(roSocket, {
          component: 'pad',
          padId: otherPadId, // The server should ignore this.
          type: 'CHANGESET_REQ',
          data: {
            granularity: 1,
            start: 'test123',
            requestID: 'requestId',
          },
        });
        assert.equal('This code should never run', 1);
      }
      catch(e:any) {
        assert.match(e.message, /rev is not a number/);
        errorCatched = 1;
      }
      finally {
        await otherPad.remove();
        assert.equal(errorCatched, 1);
      }
    });

    it('CHANGESET_REQ: revNum is converted to number if possible (regression)', async function () {
      const otherPadId = `${padId}other`;
      assert(!await padManager.doesPadExist(otherPadId));
      const otherPad = await padManager.getPad(otherPadId, 'other text\n');
      try {
        await otherPad.setText('other text\n');
        const resP = common.waitForSocketEvent(roSocket, 'message');
        await common.sendMessage(roSocket, {
          component: 'pad',
          padId: otherPadId, // The server should ignore this.
          type: 'CHANGESET_REQ',
          data: {
            granularity: 1,
            start: '1test123',
            requestID: 'requestId',
          },
        });
        const res = await resP;
        assert.equal(res.type, 'CHANGESET_REQ');
        assert.equal(res.data.requestID, 'requestId');
        assert.equal(res.data.start, 1);
      }
      finally {
        await otherPad.remove();
      }
    });

    it('CHANGESET_REQ: revNum 2 is converted to head rev 1 (regression)', async function () {
      const otherPadId = `${padId}other`;
      assert(!await padManager.doesPadExist(otherPadId));
      const otherPad = await padManager.getPad(otherPadId, 'other text\n');
      try {
        await otherPad.setText('other text\n');
        const resP = common.waitForSocketEvent(roSocket, 'message');
        await common.sendMessage(roSocket, {
          component: 'pad',
          padId: otherPadId, // The server should ignore this.
          type: 'CHANGESET_REQ',
          data: {
            granularity: 1,
            start: '2',
            requestID: 'requestId',
          },
        });
        const res = await resP;
        assert.equal(res.type, 'CHANGESET_REQ');
        assert.equal(res.data.requestID, 'requestId');
        assert.equal(res.data.start, 1);
      }
      finally {
        await otherPad.remove();
      }
    });
  });

  describe('USER_CHANGES', function () {
    // Insert ops MUST carry the author attribute (server-side validation
    // added in this PR — see PadMessageHandler.ts). Helper assembles the
    // wire form `*0+N` plus the matching apool entry for the session author.
    const authorPool = () =>
        ({numToAttrib: {0: ['author', authorId]}, nextNum: 1});
    const sendUserChanges =
        async (socket:any, cs:any, apool: any = authorPool()) =>
            await common.sendUserChanges(socket, {baseRev: rev, changeset: cs, apool});
    const assertAccepted = async (socket:any, wantRev: number) => {
      await common.waitForAcceptCommit(socket, wantRev);
      rev = wantRev;
    };
    const assertRejected = async (socket:any) => {
      const msg = await common.waitForSocketEvent(socket, 'message');
      assert.deepEqual(msg, {disconnect: 'badChangeset'});
    };

    it('changes are applied', async function () {
      await Promise.all([
        assertAccepted(socket, rev + 1),
        sendUserChanges(socket, 'Z:1>5*0+5$hello'),
      ]);
      assert.equal(pad!.text(), 'hello\n');
    });

    it('bad changeset is rejected', async function () {
      await Promise.all([
        assertRejected(socket),
        sendUserChanges(socket, 'this is not a valid changeset'),
      ]);
    });

    it('insert without author attribute is rejected', async function () {
      // Defensive validation: every '+' op must carry the author attrib so
      // pad.atext.text and pad.atext.attribs stay in lock-step. An insert
      // with empty attribs would grow text without contributing matching
      // attribute markers, leaving the stored AText in a state where the
      // two iterables disagree on length — downstream clients then fail
      // reconciliation on every subsequent pad load.
      await Promise.all([
        assertRejected(socket),
        sendUserChanges(socket, 'Z:1>5+5$hello', {numToAttrib: {}, nextNum: 0}),
      ]);
    });

    it('insert claiming the reserved system author is rejected', async function () {
      // The author equality check above already rejects wire-borne `*N`
      // that names another real user, but `a.etherpad-system` is
      // server-internal — only the spliceText / setText paths use it,
      // never a live socket.io session. A client that tries to write as
      // the system author is either confused or trying to launder edits
      // through a reserved attribution slot. Refuse.
      const systemPool = {
        numToAttrib: {0: ['author', 'a.etherpad-system']},
        nextNum: 1,
      };
      await Promise.all([
        assertRejected(socket),
        sendUserChanges(socket, 'Z:1>5*0+5$hello', systemPool),
      ]);
    });

    it('changeset that would strand the trailing \\n is rejected', async function () {
      // Defensive validation: every USER_CHANGES must leave the pad ending
      // with '\n'. The pre-existing handler used to auto-append a
      // correction revision when the trailing '\n' got stranded, but the
      // first NEW_CHANGES broadcast (the malformed user revision) reached
      // browsers BEFORE the correction did, and the browser's line
      // assembler asserts "line assembler not finished" on a non-'\n'-
      // terminated doc — kicking the watching session offline. Refuse such
      // changesets up front instead.
      //
      // Seed the pad as 'hello\n' (6 chars, 1 line), then send a changeset
      // that explicitly keeps all 6 chars (consuming the trailing '\n')
      // and inserts 'X' AFTER. Projected text = 'hello\nX' — doesn't end
      // with '\n', must be rejected. The keep spans 1 newline so the wire
      // must carry the `|1` marker to be in canonical form.
      await Promise.all([
        assertAccepted(socket, rev + 1),
        sendUserChanges(socket, 'Z:1>5*0+5$hello'),
      ]);
      assert.equal(pad!.text(), 'hello\n');
      await Promise.all([
        assertRejected(socket),
        sendUserChanges(socket, 'Z:6>1|1=6*0+1$X'),
      ]);
      // Pad must be unchanged after the rejection.
      assert.equal(pad!.text(), 'hello\n');
    });

    it('retransmission is accepted, has no effect', async function () {
      const cs = 'Z:1>5*0+5$hello';
      await Promise.all([
        assertAccepted(socket, rev + 1),
        sendUserChanges(socket, cs),
      ]);
      --rev;
      await Promise.all([
        assertAccepted(socket, rev + 1),
        sendUserChanges(socket, cs),
      ]);
      assert.equal(pad!.text(), 'hello\n');
    });

    it('identity changeset is accepted, has no effect', async function () {
      await Promise.all([
        assertAccepted(socket, rev + 1),
        sendUserChanges(socket, 'Z:1>5*0+5$hello'),
      ]);
      await Promise.all([
        assertAccepted(socket, rev),
        sendUserChanges(socket, 'Z:6>0$', {numToAttrib: {}, nextNum: 0}),
      ]);
      assert.equal(pad!.text(), 'hello\n');
    });

    it('non-identity changeset with no net change is accepted, has no effect', async function () {
      await Promise.all([
        assertAccepted(socket, rev + 1),
        sendUserChanges(socket, 'Z:1>5*0+5$hello'),
      ]);
      await Promise.all([
        assertAccepted(socket, rev),
        sendUserChanges(socket, 'Z:6>0-5*0+5$hello'),
      ]);
      assert.equal(pad!.text(), 'hello\n');
    });

    it('handleMessageSecurity can grant one-time write access', async function () {
      const cs = 'Z:1>5*0+5$hello';
      // Use roSocket's own author in the apool so the *0 reference matches
      // thisSession.author server-side. Without this, the new author-attrib
      // validation rejects the changeset before handleMessageSecurity gets
      // a chance to permit it.
      const roPool = () =>
          ({numToAttrib: {0: ['author', roAuthorId]}, nextNum: 1});
      const errRegEx = /write attempt on read-only pad/;
      // First try to send a change and verify that it was dropped.
      await assert.rejects(sendUserChanges(roSocket, cs, roPool()), errRegEx);
      // sendUserChanges() waits for message ack, so if the message was accepted then head should
      // have already incremented by the time we get here.
      assert.equal(pad!.head, rev); // Not incremented.

      // Now allow the change.
      plugins.hooks.handleMessageSecurity.push({hook_fn: () => 'permitOnce'});
      await Promise.all([
        assertAccepted(roSocket, rev + 1),
        sendUserChanges(roSocket, cs, roPool()),
      ]);
      assert.equal(pad!.text(), 'hello\n');

      // The next change should be dropped.
      plugins.hooks.handleMessageSecurity = [];
      await assert.rejects(
          sendUserChanges(roSocket, 'Z:6>6=5*0+6$ world', roPool()), errRegEx);
      assert.equal(pad!.head, rev); // Not incremented.
      assert.equal(pad!.text(), 'hello\n');
    });
  });
});
