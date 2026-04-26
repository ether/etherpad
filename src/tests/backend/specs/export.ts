'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {MapArrayType} from "../../../node/types/MapType.js";
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as common from '../common.js';
import * as padManager from '../../../node/db/PadManager.js';
import settings from '../../../node/utils/Settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe(__filename, function () {
  let agent:any;
  const settingsBackup:MapArrayType<any> = {};
  let fakeSofficePath = '';

  before(async function () {
    agent = await common.init();
    settingsBackup.soffice = settings.soffice;
    await padManager.getPad('testExportPad', 'test content');
    const suffix = process.platform === 'win32' ? '.cmd' : '.sh';
    fakeSofficePath = path.join(os.tmpdir(), `etherpad-fake-soffice-${process.pid}${suffix}`);
    if (process.platform === 'win32') {
      await fs.writeFile(fakeSofficePath, '@echo off\r\nexit /b 1\r\n');
    } else {
      await fs.writeFile(fakeSofficePath, '#!/bin/sh\nexit 1\n');
      await fs.chmod(fakeSofficePath, 0o755);
    }
  });

  after(async function () {
    Object.assign(settings, settingsBackup);
    if (fakeSofficePath !== '') await fs.rm(fakeSofficePath, {force: true});
  });

  it('returns 500 on export error', async function () {
    settings.soffice = fakeSofficePath;
    await agent.get('/p/testExportPad/export/doc')
        .expect(500);
  });
});
