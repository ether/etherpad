'use strict';

import {MapArrayType} from '../../../node/types/MapType';
import path from 'path';
import {promises as fs} from 'fs';

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
import settings from '../../../node/utils/Settings';

describe(__filename, function () {
  const settingsBackup: MapArrayType<any> = {};
  let agent: any;

  before(async function () {
    agent = await common.init();
    settingsBackup.soffice = settings.soffice;
  });

  after(function () {
    Object.assign(settings, settingsBackup);
  });

  describe('docxBufferToHtml (#7538)', function () {
    let docxBufferToHtml: (b: Buffer) => Promise<string>;

    before(function () {
      try { require.resolve('mammoth'); }
      catch { this.skip(); return; }
      docxBufferToHtml = require('../../../node/utils/ImportDocxNative').docxBufferToHtml;
    });

    it('converts the sample.docx fixture to HTML', async function () {
      const buf = await fs.readFile(
          path.join(__dirname, 'fixtures', 'sample.docx'));
      const html = await docxBufferToHtml(buf);
      assert.match(html, /Heading/);
      assert.match(html, /Paragraph body\./);
      assert.match(html, /one/);
      assert.match(html, /two/);
    });

    it('emits no remote image URLs', async function () {
      const buf = await fs.readFile(
          path.join(__dirname, 'fixtures', 'sample.docx'));
      const html = await docxBufferToHtml(buf);
      assert.doesNotMatch(html, /<img[^>]+src="https?:/);
      assert.doesNotMatch(html, /<img[^>]+src="\/\//);
    });
  });
});
