'use strict';

/**
 * Coverage for the "every insert op must carry an `author` attribute"
 * invariant enforced in Pad.appendRevision. The same invariant exists
 * at the socket boundary; the pad-level check covers the non-wire
 * callers (HTTP API setHTML/setText/restoreRevision/copyPad and
 * plugin paths that call appendRevision directly).
 */

import {PadType} from '../../../node/types/PadType';

import {strict as assert} from 'assert';
const common = require('../common');
const padManager = require('../../../node/db/PadManager');

describe(__filename, function () {
  let pad: PadType | null;
  let padId: string;

  beforeEach(async function () {
    padId = common.randomString();
    assert(!(await padManager.doesPadExist(padId)));
    pad = await padManager.getPad(padId, '');
  });

  afterEach(async function () {
    if (pad != null) await pad.remove();
    pad = null;
  });

  describe('appendRevision rejects malformed insert ops', function () {
    it('rejects a `+N$chars` insert op with NO attribs at all', async function () {
      // Pad text is "\n" after getPad(_, ''), so oldLen=1.
      // Z:1>5+5$world  =  insert "world" at start, no attribs.
      const malicious = 'Z:1>5+5$world';
      await assert.rejects(
          (pad as any).appendRevision(malicious, 'a.test'),
          (err: Error) => /insert op without an author/.test(err.message));
    });

    it('rejects a multi-op changeset whose first insert lacks an author', async function () {
      // Two inserts: the first has no attribs at all (bad), the second
      // would have a valid author marker if we'd added one. The whole
      // changeset must be rejected — partial application is exactly
      // the failure mode that left clients out of sync.
      const malicious = 'Z:1>a+5+5$worldhello';
      await assert.rejects(
          (pad as any).appendRevision(malicious, 'a.test'),
          (err: Error) => /insert op without an author/.test(err.message));
    });

    it('accepts a well-formed insert that carries the author attribute', async function () {
      // Populate the pool so attrib 0 = ['author', 'a.test']. Use the
      // pad's own setText to drive that without hand-rolling an
      // AttributePool serialization.
      await pad!.setText('hello\n', 'a.test');
      assert.equal(pad!.text(), 'hello\n');
    });

    it('does NOT reject `=` and `-` ops with empty attribs (legit canonical form)', async function () {
      // First put text in the pad with a known author.
      await pad!.setText('hello world\n', 'a.test');
      // A pure delete (no insert) at position 0 is `=0-5` — but `=0` is
      // not emitted by the canonical assembler, so use a keep+delete:
      // delete the first 5 chars ("hello"). authorId on appendRevision
      // need not match the deletion: '-' ops don't need an author
      // marker. The handler should accept this.
      const after = pad!.text(); // sanity
      assert.equal(after, 'hello world\n');
      // Delete chars 0..5 ("hello ") -> "world\n"
      await (pad as any).spliceText(0, 6, '', 'a.test');
      assert.equal(pad!.text(), 'world\n');
    });
  });

  describe('setPadRaw (.etherpad import) — placeholder for future coverage', function () {
    // `.etherpad` import bulk-writes records via setPadRaw and skips
    // appendRevision, so this code path is not yet covered by the
    // appendRevision-level check. Coverage will land alongside the
    // import-side handling.
    it.skip('TODO: refuse / sanitize unattributed inserts on .etherpad import',
        async function () { /* placeholder */ });
  });

  describe('legacy replay paths cope with unattributed historical ops', function () {
    // Simulates a stored atext written before the SYSTEM_AUTHOR_ID
    // substitution was the server-side default. restoreRevision and
    // copyPadWithoutHistory both reconstruct a changeset from a
    // source atext; if any run lacks an `author` attribute, the new
    // appendRevision guard would otherwise throw and the API would
    // return a 5xx for legacy pads.

    // Force the in-memory pad into a legacy shape: atext.attribs with
    // a bare `+N` insert (no `*K` markers), pool emptied. Bypass
    // spliceText/setText, which would substitute SYSTEM_AUTHOR_ID.
    const installLegacyAText = async (p: any, text: string) => {
      const AttributePool = require('../../../static/js/AttributePool').default;
      p.pool = new AttributePool();
      p.atext = {
        text: text + '\n',
        attribs: `+${text.length.toString(36)}|1+1`,
      };
      await p.saveToDatabase();
    };

    // NOTE: restoreRevision reads the source atext from the historical
    // revs:N record on disk (not from the in-memory pad.atext), so a
    // pure in-memory poison helper can't exercise its replay path
    // end-to-end. Direct DB manipulation of a stored rev record would
    // close that gap; the copyPadWithoutHistory case below already
    // exercises the same AttributeMap merge logic that the
    // restoreRevision fix uses, so the symmetric code-path is covered.
    it.skip('TODO: restoreRevision merges in an author when the historical rev lacks one',
        async function () { /* placeholder */ });

    it('copyPadWithoutHistory merges in an author when the source atext lacks one',
        async function () {
          const api = require('../../../node/db/API');
          const destId = common.randomString();
          await installLegacyAText(pad, 'legacy source');
          // Should not throw on the destination's appendRevision.
          await api.copyPadWithoutHistory(padId, destId, true, 'a.copier');
          // Cleanup the destination so afterEach doesn't double-remove.
          const destPad = await padManager.getPad(destId);
          await destPad.remove();
        });
  });
});
