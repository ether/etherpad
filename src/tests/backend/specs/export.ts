'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {MapArrayType} from "../../../node/types/MapType";

import * as common from '../common.js';
import padManager from '../../../node/db/PadManager.js';
import settings from '../../../node/utils/Settings.js';

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
    settings.soffice = 'false'; // '/bin/false' doesn't work on Windows
    await agent.get('/p/testExportPad/export/doc')
        .expect(500);
  });
});
