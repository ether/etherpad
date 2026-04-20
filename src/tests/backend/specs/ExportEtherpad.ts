'use strict';

const assert = require('assert').strict;
const common = require('../common');
const exportEtherpad = require('../../../node/utils/ExportEtherpad');
const padManager = require('../../../node/db/PadManager');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import readOnlyManager from '../../../node/db/ReadOnlyManager';

describe(__filename, function () {
  let padId:string;

  beforeEach(async function () {
    padId = common.randomString();
    assert(!await padManager.doesPadExist(padId));
  });

  describe('exportEtherpadAdditionalContent', function () {
    let hookBackup: ()=>void;

    before(async function () {
      hookBackup = plugins.hooks.exportEtherpadAdditionalContent || [];
      plugins.hooks.exportEtherpadAdditionalContent = [{hook_fn: () => ['custom']}];
    });

    after(async function () {
      plugins.hooks.exportEtherpadAdditionalContent = hookBackup;
    });

    it('exports custom records', async function () {
      const pad = await padManager.getPad(padId);
      await pad.db.set(`custom:${padId}`, 'a');
      await pad.db.set(`custom:${padId}:`, 'b');
      await pad.db.set(`custom:${padId}:foo`, 'c');
      const data = await exportEtherpad.getPadRaw(pad.id, null);
      assert.equal(data[`custom:${padId}`], 'a');
      assert.equal(data[`custom:${padId}:`], 'b');
      assert.equal(data[`custom:${padId}:foo`], 'c');
    });

    it('export from read-only pad uses read-only ID', async function () {
      const pad = await padManager.getPad(padId);
      const readOnlyId = await readOnlyManager.getReadOnlyId(padId);
      await pad.db.set(`custom:${padId}`, 'a');
      await pad.db.set(`custom:${padId}:`, 'b');
      await pad.db.set(`custom:${padId}:foo`, 'c');
      const data = await exportEtherpad.getPadRaw(padId, readOnlyId);
      assert.equal(data[`custom:${readOnlyId}`], 'a');
      assert.equal(data[`custom:${readOnlyId}:`], 'b');
      assert.equal(data[`custom:${readOnlyId}:foo`], 'c');
      assert(!(`custom:${padId}` in data));
      assert(!(`custom:${padId}:` in data));
      assert(!(`custom:${padId}:foo` in data));
    });

    it('does not export records from pad with similar ID', async function () {
      const pad = await padManager.getPad(padId);
      await pad.db.set(`custom:${padId}x`, 'a');
      await pad.db.set(`custom:${padId}x:`, 'b');
      await pad.db.set(`custom:${padId}x:foo`, 'c');
      const data = await exportEtherpad.getPadRaw(pad.id, null);
      assert(!(`custom:${padId}x` in data));
      assert(!(`custom:${padId}x:` in data));
      assert(!(`custom:${padId}x:foo` in data));
    });
  });

  // Regression test for https://github.com/ether/etherpad/issues/5071.
  // `/p/:pad/:rev/export/etherpad` and getPadRaw() historically ignored the
  // rev parameter and always exported the full history, surprising users
  // who wanted to back up or inspect an earlier snapshot.
  describe('revNum bounding (issue #5071)', function () {
    const addRevs = async (pad: any, n: number) => {
      // Each call to .appendRevision bumps head by one, producing a
      // distinct revision we can count in the exported payload.
      for (let i = 0; i < n; i++) {
        await pad.appendText(`line ${i}\n`);
      }
    };

    it('defaults to full history when revNum is omitted', async function () {
      const pad = await padManager.getPad(padId);
      await addRevs(pad, 3);
      const data = await exportEtherpad.getPadRaw(padId, null);
      // revs 0 (pad-create) through pad.head inclusive.
      const revKeys =
          Object.keys(data).filter((k) => k.startsWith(`pad:${padId}:revs:`));
      assert.equal(revKeys.length, pad.head + 1);
      assert.equal(data[`pad:${padId}`].head, pad.head);
    });

    it('limits exported revisions to 0..revNum when supplied', async function () {
      const pad = await padManager.getPad(padId);
      await addRevs(pad, 5);
      const bound = 2;
      const data = await exportEtherpad.getPadRaw(padId, null, bound);
      const revKeys =
          Object.keys(data).filter((k) => k.startsWith(`pad:${padId}:revs:`));
      assert.equal(revKeys.length, bound + 1,
          `expected ${bound + 1} revisions, got ${revKeys.length}`);
      assert(!(`pad:${padId}:revs:${bound + 1}` in data),
          'rev after bound must not be exported');
      // The serialized pad must also reflect the bounded head so that
      // re-importing reconstructs the pad at the requested rev.
      assert.equal(data[`pad:${padId}`].head, bound);
    });

    it('treats a revNum above head as equivalent to full history', async function () {
      const pad = await padManager.getPad(padId);
      await addRevs(pad, 3);
      const data = await exportEtherpad.getPadRaw(padId, null, pad.head + 100);
      assert.equal(data[`pad:${padId}`].head, pad.head);
    });
  });
});
