'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {MapArrayType} from "../../../node/types/MapType.js";

import * as common from '../common.js';
import * as padManager from '../../../node/db/PadManager.js';
import settings from '../../../node/utils/Settings.js';
import plugins from '../../../static/js/pluginfw/plugin_defs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe(__filename, function () {
  let agent:any;
  const settingsBackup:MapArrayType<any> = {};

  before(async function () {
    agent = await common.init();
    settingsBackup.soffice = settings.soffice;
    await padManager.getPad('testExportPad', 'test content');
  });

  after(async function () {
    Object.assign(settings, settingsBackup);
  });

  it('returns 500 on export error', async function () {
    settings.soffice = 'dummy-soffice-command';
    const exportConvertBackup = plugins.hooks.exportConvert || [];
    plugins.hooks.exportConvert = [{
      hook_fn: async () => {
        throw new Error('forced export conversion failure');
      },
    }];
    try {
      await agent.get('/p/testExportPad/export/doc')
          .expect(500);
    } finally {
      plugins.hooks.exportConvert = exportConvertBackup;
    }
  });
});
