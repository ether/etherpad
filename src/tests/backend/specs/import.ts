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

  describe('end-to-end DOCX import (#7538)', function () {
    before(function () {
      try { require.resolve('mammoth'); }
      catch { this.skip(); return; }
      settings.soffice = null;
    });

    it('imports a docx into a pad without soffice', async function () {
      const padId = 'test7538DocxImport';
      try { await padManager.removePad(padId); } catch { /* noop */ }
      const fixture = path.join(__dirname, 'fixtures', 'sample.docx');
      const res = await agent
          .post(`/p/${padId}/import`)
          .attach('file', fixture)
          .expect(200);
      assert.strictEqual(res.body.code, 0,
          `import failed: ${JSON.stringify(res.body)}`);
      const pad = await padManager.getPad(padId);
      const text = pad.text();
      assert.match(text, /Heading/);
      assert.match(text, /Paragraph body/);
      assert.match(text, /one/);
      assert.match(text, /two/);
    });

    it('rejects odt extension when soffice is null', async function () {
      const padId = 'test7538OdtReject';
      try { await padManager.removePad(padId); } catch { /* noop */ }
      const fixture = path.join(__dirname, 'fixtures', 'sample.docx');
      const odtPath = path.join(__dirname, 'fixtures', 'sample.odt');
      await fs.copyFile(fixture, odtPath);
      try {
        const res = await agent
            .post(`/p/${padId}/import`)
            .attach('file', odtPath);
        assert.ok(
            res.status >= 400 || res.body.code !== 0,
            `expected odt import to fail when soffice is null, got: ${res.status} ${JSON.stringify(res.body)}`);
      } finally {
        await fs.unlink(odtPath).catch(() => undefined);
      }
    });
  });
});
