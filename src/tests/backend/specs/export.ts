'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {MapArrayType} from "../../../node/types/MapType.js";

import * as common from '../common.js';
import * as padManager from '../../../node/db/PadManager.js';
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
    // Use an existing executable so spawn succeeds on all platforms, but with
    // invalid soffice args so conversion fails and returns HTTP 500.
    settings.soffice = process.execPath;
    await agent.get('/p/testExportPad/export/doc')
        .expect(500);
  });
});
