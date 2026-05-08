'use strict';

import {MapArrayType} from '../../../node/types/MapType';
import path from 'path';
import os from 'os';
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

  describe('DOCX export -> import round-trip (#7538)', function () {
    before(function () {
      try {
        require.resolve('html-to-docx');
        require.resolve('mammoth');
      } catch {
        this.skip();
        return;
      }
      settings.soffice = null;
    });

    // Returns the supertest Test so callers can keep chaining .expect();
    // typing as `any` because supertest's Test isn't re-exported as a type
    // we can name here.
    const fetchBuffer = (req: any): any => req
        .buffer(true)
        .parse((resp: any, cb: any) => {
          const chunks: Buffer[] = [];
          resp.on('data', (c: Buffer) => chunks.push(c));
          resp.on('end', () => cb(null, Buffer.concat(chunks)));
        });

    it('preserves text content through native DOCX round-trip', async function () {
      const srcPadId = 'test7538RoundTripSrc';
      const dstPadId = 'test7538RoundTripDst';
      const tmpFile = path.join(os.tmpdir(), `roundtrip-${process.pid}.docx`);

      try {
        await padManager.removePad(srcPadId);
        await padManager.removePad(dstPadId);
      } catch { /* noop */ }

      const srcPad = await padManager.getPad(srcPadId, '\n');
      await srcPad.setText('Line one\nLine two\n\nAfter the blank line\n');
      const srcText = srcPad.text();
      assert.match(srcText, /Line one/);
      assert.match(srcText, /After the blank line/);

      const exp = await fetchBuffer(agent.get(`/p/${srcPadId}/export/docx`))
          .expect(200);
      const docxBuffer: Buffer = exp.body as Buffer;
      assert.strictEqual(docxBuffer.slice(0, 4).toString('latin1'), 'PK\x03\x04');
      await fs.writeFile(tmpFile, docxBuffer);

      try {
        const imp = await agent
            .post(`/p/${dstPadId}/import`)
            .attach('file', tmpFile)
            .expect(200);
        assert.strictEqual(imp.body.code, 0,
            `import failed: ${JSON.stringify(imp.body)}`);

        const dstPad = await padManager.getPad(dstPadId);
        const dstText = dstPad.text();
        assert.match(dstText, /Line one/);
        assert.match(dstText, /Line two/);
        assert.match(dstText, /After the blank line/);
      } finally {
        await fs.unlink(tmpFile).catch(() => undefined);
      }
    });

    it('preserves text content through native PDF export (sanity check)', async function () {
      // PDF round-trip is one-way (no native PDF import) -- this just
      // verifies the exported PDF has the source text in its visible
      // content stream, so we know nothing got dropped on export.
      const padId = 'test7538PdfSanity';
      try { await padManager.removePad(padId); } catch { /* noop */ }
      const pad = await padManager.getPad(padId, '\n');
      await pad.setText('Hello PDF\nSecond line\n');

      const exp = await fetchBuffer(agent.get(`/p/${padId}/export/pdf`))
          .expect(200);
      const pdf: Buffer = exp.body as Buffer;
      assert.strictEqual(pdf.slice(0, 5).toString('ascii'), '%PDF-');

      // pdfkit emits text as hex strings inside TJ ops; concat them and
      // search the visible content.
      const ascii = pdf.toString('latin1');
      const visible: string[] = [];
      const re = /<([0-9a-fA-F]{2,})>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(ascii)) !== null) {
        visible.push(Buffer.from(m[1], 'hex').toString('latin1'));
      }
      const concatenated = visible.join('');
      assert.ok(concatenated.includes('Hello PDF'),
          `expected "Hello PDF" in PDF visible content: ${concatenated}`);
      assert.ok(concatenated.includes('Second line'),
          `expected "Second line" in PDF visible content: ${concatenated}`);
    });
  });
});
