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
});
