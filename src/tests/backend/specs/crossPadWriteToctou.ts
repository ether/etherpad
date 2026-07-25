'use strict';

/**
 * Regression for GHSA-6mcx-x5h6-rpw2 (PadMessageHandler TOCTOU cross-pad write).
 *
 * A USER_CHANGES message is authorized and enqueued against the pad the session
 * points at when the message ARRIVES, but the actual write ran later and re-read
 * the mutable sessioninfos[socket.id].padId. A concurrent same-socket
 * CLIENT_READY could swap that padId in between, redirecting the queued write
 * onto a read-only / unauthorized pad.
 *
 * The fix threads the enqueue-time pad id (the channel key) into
 * handleUserChanges as `authorizedPadId`, which is used for the write. This test
 * drives that seam directly: it invokes handleUserChanges with the session's
 * padId ALREADY swapped to a victim pad, and asserts the change lands on the
 * authorized (argument) pad and never on the victim.
 */

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const authorManager = require('../../../node/db/AuthorManager');
const padMessageHandler = require('../../../node/handler/PadMessageHandler');

describe(__filename, function () {
  this.timeout(30000);

  before(async function () { await common.init(); });

  it('applies a queued change to the enqueue-time pad, not the swapped session pad',
      async function () {
        const authorizedId = `toctou_authorized_${common.randomString()}`;
        const victimId = `toctou_victim_${common.randomString()}`;
        // Identical seed text so the changeset is valid against either pad — the
        // point is *which* pad receives it, not changeset validity.
        const authorizedPad = await padManager.getPad(authorizedId, 'seed\n');
        await authorizedPad.setText('seed\n');
        const victimPad = await padManager.getPad(victimId, 'seed\n');
        await victimPad.setText('seed\n');
        assert.equal(authorizedPad.text(), 'seed\n');
        const baseRev = authorizedPad.getHeadRevisionNumber();

        const {authorID} = await authorManager.createAuthor('toctou');

        // Fake socket that captures server emits instead of using the wire.
        const emitted: any[] = [];
        const socket = {id: `toctou-socket-${common.randomString()}`, emit: (_e: string, m: any) => emitted.push(m)};

        // Simulate the attack window: the session padId has ALREADY been swapped
        // to the victim by a concurrent CLIENT_READY. The author is kept (the
        // TOCTOU keeps the attacker's author, so the author check passes).
        const {sessioninfos} = padMessageHandler;
        sessioninfos[socket.id] = {padId: victimId, author: authorID, rev: baseRev, readonly: false};

        // A valid insert of "ZZ" at the start, attributed to `authorID`.
        const message = {
          data: {
            baseRev,
            apool: {numToAttrib: {0: ['author', authorID]}, nextNum: 1},
            changeset: 'Z:5>2*0+2$ZZ',
          },
        };

        const realUpdatePadClients = padMessageHandler.updatePadClients;
        padMessageHandler.updatePadClients = async () => {}; // neutralise fan-out
        try {
          // authorizedPadId = the pad authorized at enqueue time (NOT the swapped
          // session padId).
          await padMessageHandler.handleUserChanges(socket, message, authorizedId);
        } finally {
          padMessageHandler.updatePadClients = realUpdatePadClients;
          delete sessioninfos[socket.id];
        }

        const freshAuthorized = await padManager.getPad(authorizedId);
        const freshVictim = await padManager.getPad(victimId);

        assert.equal(freshVictim.text(), 'seed\n',
            'the victim pad (swapped session padId) must NOT be modified');
        assert.equal(freshAuthorized.text(), 'ZZseed\n',
            'the change must land on the enqueue-time authorized pad');

        await authorizedPad.remove();
        await victimPad.remove();
      });
});
