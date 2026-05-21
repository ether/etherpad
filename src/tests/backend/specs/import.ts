'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {createRequire} from 'node:module';
import {strict as assert} from 'node:assert';
import {MapArrayType} from '../../../node/types/MapType.js';
import path from 'path';
import os from 'os';
import {promises as fs} from 'fs';

import * as common from '../common.js';
import * as padManager from '../../../node/db/PadManager.js';
import settings from '../../../node/utils/Settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Inline CJS bridge for the optional native-import modules (mammoth,
// html-to-docx) — the test body uses `require.resolve()` to skip
// gracefully on installs that don't ship them.
const require = createRequire(import.meta.url);

const canResolve = (mod: string): boolean => {
  try { require.resolve(mod); return true; } catch { return false; }
};
const hasMammoth = canResolve('mammoth');
const hasHtmlToDocx = canResolve('html-to-docx');
const hasDocxRoundTrip = hasMammoth && hasHtmlToDocx;

describe(__filename, () => {
  const settingsBackup: MapArrayType<any> = {};
  let agent: any;

  before(async () => {
    agent = await common.init();
    settingsBackup.soffice = settings.soffice;
  });

  after(() => {
    Object.assign(settings, settingsBackup);
  });

  describe.skipIf(!hasMammoth)('docxBufferToHtml (#7538)', () => {
    let docxBufferToHtml: (b: Buffer) => Promise<string>;

    before(() => {
      docxBufferToHtml = require('../../../node/utils/ImportDocxNative').docxBufferToHtml;
    });

    it('converts the sample.docx fixture to HTML', async () => {
      const buf = await fs.readFile(
          path.join(__dirname, 'fixtures', 'sample.docx'));
      const html = await docxBufferToHtml(buf);
      assert.match(html, /Heading/);
      assert.match(html, /Paragraph body\./);
      assert.match(html, /one/);
      assert.match(html, /two/);
    });

    it('emits no remote image URLs', async () => {
      const buf = await fs.readFile(
          path.join(__dirname, 'fixtures', 'sample.docx'));
      const html = await docxBufferToHtml(buf);
      assert.doesNotMatch(html, /<img[^>]+src="https?:/);
      assert.doesNotMatch(html, /<img[^>]+src="\/\//);
    });

    it.skipIf(!hasHtmlToDocx)('preserves paragraph alignment from <w:jc>', async () => {
      // Round through html-to-docx so the input docx has <w:jc> entries
      // we can verify mammoth + our workaround surface as text-align.
      const htmlToDocx = require('html-to-docx');
      const docx: Buffer = await htmlToDocx(
          '<h1 style="text-align:right">Right heading</h1>' +
          '<p style="text-align:center">Center paragraph</p>' +
          '<p>Left paragraph</p>' +
          '<p style="text-align:justify">Justify paragraph</p>');
      const html = await docxBufferToHtml(docx);
      assert.match(html, /<h1[^>]*style="[^"]*text-align:right/,
          `expected right-aligned h1 in: ${html}`);
      assert.match(html, /<p[^>]*style="[^"]*text-align:center/,
          `expected center-aligned p in: ${html}`);
      assert.match(html, /<p[^>]*style="[^"]*text-align:justify/,
          `expected justify-aligned p in: ${html}`);
      // Left-aligned paragraph should NOT carry a redundant style attr
      // (we skip "left" because it's the CSS default).
      assert.match(html, /<p>Left paragraph<\/p>/);
    });
  });

  describe.skipIf(!hasMammoth)('end-to-end DOCX import (#7538)', () => {
    before(() => {
      settings.soffice = null;
    });

    it('imports a docx into a pad without soffice', async () => {
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

    it('rejects odt extension when soffice is null', async () => {
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

  describe.skipIf(!hasDocxRoundTrip)('DOCX export -> import round-trip (#7538)', () => {
    before(() => {
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

    it('preserves text content through native DOCX round-trip', async () => {
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

    // Bidirectional round-trip: export from src pad, import into dst pad,
    // export again. Compare exhibit (a) to exhibit (c). For text-based
    // formats (txt, etherpad) this is straight byte equality. For HTML
    // and DOCX we compare the relevant invariants (line text, paragraph
    // count) since whitespace and metadata can differ between exports.
    const exportPad = async (padId: string, type: string): Promise<Buffer> => {
      const r = await fetchBuffer(agent.get(`/p/${padId}/export/${type}`))
          .expect(200);
      return r.body as Buffer;
    };

    const importToPad = async (padId: string, content: Buffer, ext: string) => {
      try { await padManager.removePad(padId); } catch { /* noop */ }
      const tmp = path.join(os.tmpdir(),
          `roundtrip-${process.pid}-${Date.now()}.${ext}`);
      await fs.writeFile(tmp, content);
      try {
        const r = await agent.post(`/p/${padId}/import`)
            .attach('file', tmp).expect(200);
        assert.strictEqual(r.body.code, 0,
            `${ext} import failed: ${JSON.stringify(r.body)}`);
      } finally {
        await fs.unlink(tmp).catch(() => undefined);
      }
    };

    const seedPad = async (padId: string, text: string) => {
      try { await padManager.removePad(padId); } catch { /* noop */ }
      const pad = await padManager.getPad(padId, '\n');
      await pad.setText(text);
    };

    const SAMPLE_TEXT = 'Line one\nLine two\n\nAfter blank\n';

    it('a==c round-trip: txt export -> import -> export', async () => {
      const src = 'test7538RtTxtSrc';
      const dst = 'test7538RtTxtDst';
      await seedPad(src, SAMPLE_TEXT);
      const a = await exportPad(src, 'txt');
      await importToPad(dst, a, 'txt');
      const c = await exportPad(dst, 'txt');
      assert.strictEqual(c.toString('utf8'), a.toString('utf8'),
          `txt round-trip drift\nA:${JSON.stringify(a.toString('utf8'))}\nC:${JSON.stringify(c.toString('utf8'))}`);
    });

    it('a==c round-trip: etherpad export -> import -> export', async () => {
      const src = 'test7538RtEpadSrc';
      const dst = 'test7538RtEpadDst';
      await seedPad(src, SAMPLE_TEXT);
      const a = await exportPad(src, 'etherpad');
      await importToPad(dst, a, 'etherpad');
      const c = await exportPad(dst, 'etherpad');
      // etherpad format is JSON metadata + atext; the surrounding metadata
      // (timestamps, ids) differs across pads. Assert the line content
      // matches by parsing pad text from both pads.
      const srcText = (await padManager.getPad(src)).text();
      const dstText = (await padManager.getPad(dst)).text();
      assert.strictEqual(dstText, srcText,
          `etherpad round-trip drift\nsrc:${JSON.stringify(srcText)}\ndst:${JSON.stringify(dstText)}`);
      assert.ok(a.length > 0 && c.length > 0,
          'expected non-empty etherpad bodies');
    });

    it('a==c round-trip: html export -> import -> export', async () => {
      const src = 'test7538RtHtmlSrc';
      const dst = 'test7538RtHtmlDst';
      await seedPad(src, SAMPLE_TEXT);
      const a = (await exportPad(src, 'html')).toString('utf8');
      await importToPad(dst, Buffer.from(a, 'utf8'), 'html');
      const c = (await exportPad(dst, 'html')).toString('utf8');
      // Strip <head> (skin-versioned hashes), trim trailing whitespace,
      // and trim trailing <br>s — etherpad's setPadHTML appends an empty
      // <p> on import to keep a caret below the last line, which adds
      // exactly one trailing newline per round-trip. That's pre-existing
      // core behavior, so the meaningful invariant is "content lines
      // match" with the trailing newline tolerated.
      const bodyOf = (s: string) =>
          (s.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? '')
              .replace(/(?:<br\s*\/?>\s*)+$/i, '')
              .trim();
      assert.strictEqual(bodyOf(c), bodyOf(a),
          `html body drift\nA:${JSON.stringify(bodyOf(a))}\nC:${JSON.stringify(bodyOf(c))}`);
    });

    it('a==c round-trip: docx export -> import -> export (line text)',
        async () => {
      const src = 'test7538RtDocxSrc';
      const dst = 'test7538RtDocxDst';
      await seedPad(src, SAMPLE_TEXT);
      const a = await exportPad(src, 'docx');
      await importToPad(dst, a, 'docx');
      // Compare pad text, not docx bytes -- DOCX includes timestamps
      // and pad ID metadata in the document properties so byte equality
      // is impossible. Pad text equality is the right invariant.
      const srcText = (await padManager.getPad(src)).text();
      const dstText = (await padManager.getPad(dst)).text();
      // setPadHTML appends a trailing newline on import, so dst is
      // expected to be src plus one trailing '\n'.
      const srcNorm = srcText.replace(/\n+$/, '\n');
      const dstNorm = dstText.replace(/\n+$/, '\n');
      assert.strictEqual(dstNorm, srcNorm,
          `docx round-trip drift\nsrc:${JSON.stringify(srcText)}\ndst:${JSON.stringify(dstText)}`);
    });
  });

  // These tests assume ep_headings2 (or another plugin) registers h1/h2/etc.
  // as server-side block elements via `ccRegisterBlockElements`. Without that
  // hook, contentcollector treats <h1>/<h2> as inline and adjacent ones merge
  // into a single pad line — making the assertions below moot. The CI
  // backend-tests job runs without plugins installed, so each test skips at
  // runtime via ctx.skip() if the hook isn't registered. Local dev with
  // ep_headings2 installed exercises them.
  describe('HTML import — adjacent headings (#7538)', () => {
    let headingsAreBlocks = false;
    before(async () => {
      const hooks = require('../../../static/js/pluginfw/hooks');
      const ccBlockElems: string[] = ([] as string[]).concat(
          ...(hooks.callAll('ccRegisterBlockElements') || []));
      headingsAreBlocks = ccBlockElems.map((t: string) => t.toLowerCase())
          .includes('h1');
      if (headingsAreBlocks) settings.soffice = null;
    });

    const importHtml = async (padId: string, html: string) => {
      try { await padManager.removePad(padId); } catch { /* noop */ }
      const tmp = path.join(os.tmpdir(),
          `htmlimport-${process.pid}-${Date.now()}.html`);
      await fs.writeFile(tmp, html);
      try {
        const r = await agent.post(`/p/${padId}/import`)
            .attach('file', tmp).expect(200);
        assert.strictEqual(r.body.code, 0,
            `import failed: ${JSON.stringify(r.body)}`);
      } finally {
        await fs.unlink(tmp).catch(() => undefined);
      }
    };

    it('does not introduce a blank line between H1 and H2', async (ctx) => {
      if (!headingsAreBlocks) ctx.skip();
      const padId = 'test7538HtmlH1H2';
      await importHtml(padId, '<html><body><h1>A</h1><h2>B</h2></body></html>');
      const pad = await padManager.getPad(padId);
      const lines = (pad.text().split('\n') as string[]).filter(
          (l: string, i: number, arr: string[]) =>
              // ignore the trailing blank line setPadHTML always appends
              !(l === '' && i === arr.length - 1));
      // We want exactly two content lines (A and B), no blank line
      // injected between them.
      const meaningful = lines.filter((l: string) => l.trim().length > 0);
      assert.deepStrictEqual(meaningful.length, 2,
          `expected 2 content lines, got: ${JSON.stringify(lines)}`);
      const between = lines.slice(
          lines.findIndex((l: string) => l.includes('A')) + 1,
          lines.findIndex((l: string) => l.includes('B')));
      assert.deepStrictEqual(between, [],
          `expected no blank line between A and B, got: ${JSON.stringify(between)}`);
    });

    // Reproduce the realistic export-side shape: H1 + two blank pad lines
    // (encoded by ep_align as `<br><p style></p><br><p style></p><br>`)
    // + H2. The pad should round-trip back to H1, blank, blank, H2 -- not
    // gain or lose blank lines.
    it('preserves blank-line count between H1 and H2 (realistic shape)', async (ctx) => {
      if (!headingsAreBlocks) ctx.skip();
      const padId = 'test7538HtmlBlankLines';
      const html =
          '<html><body>' +
          "<h1 style='text-align:right'>A</h1><br>" +
          "<p style='text-align:right'></p><br>" +
          "<p style='text-align:right'></p><br>" +
          "<h2 style='text-align:center'>B</h2><br>" +
          '</body></html>';
      await importHtml(padId, html);
      const pad = await padManager.getPad(padId);
      const lines: string[] = pad.text().split('\n');
      // Drop the trailing-newline appended by setPadHTML on import.
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      // Expect: A, '', '', B
      const aIdx = lines.findIndex((l: string) => l.includes('A'));
      const bIdx = lines.findIndex((l: string) => l.includes('B'));
      assert.notStrictEqual(aIdx, -1, `expected A: ${JSON.stringify(lines)}`);
      assert.notStrictEqual(bIdx, -1, `expected B: ${JSON.stringify(lines)}`);
      const blankCount = bIdx - aIdx - 1;
      assert.strictEqual(blankCount, 2,
          `expected 2 blank lines between A and B, got ${blankCount}: ${JSON.stringify(lines)}`);
    });
  });

  describe.skipIf(!hasDocxRoundTrip)('Round-trip integrity: heading-style content (#7538)', () => {
    before(() => {
      settings.soffice = null;
    });

    const fetchBuffer = (req: any): any => req
        .buffer(true)
        .parse((resp: any, cb: any) => {
          const chunks: Buffer[] = [];
          resp.on('data', (c: Buffer) => chunks.push(c));
          resp.on('end', () => cb(null, Buffer.concat(chunks)));
        });

    it('keeps adjacent heading-style blocks on separate lines after round-trip', async () => {
      // Regression: ep_headings2 emits <h1>/<h2>/<code> that aren't in
      // contentcollector's default block-element set. Without the
      // separateAdjacentHeadingBlocks fix, mammoth's <h1>A</h1><h2>B</h2>
      // would merge into one pad line.
      const srcPadId = 'test7538MultiHeading';
      const dstPadId = 'test7538MultiHeadingImport';
      const tmpFile = path.join(os.tmpdir(), `multiheading-${process.pid}.docx`);

      try {
        await padManager.removePad(srcPadId);
        await padManager.removePad(dstPadId);
      } catch { /* noop */ }

      // Drive the import path directly with a hand-crafted DOCX whose
      // content is just three adjacent block elements; this is what
      // mammoth produces from the round-trip output of ep_headings2's
      // pad HTML.
      const htmlToDocx = require('html-to-docx');
      const buf: Buffer = await htmlToDocx(
          '<h1>Welcome</h1><h2>This pad</h2><p>Code line</p>');
      await fs.writeFile(tmpFile, buf);

      try {
        await agent.post(`/p/${dstPadId}/import`)
            .attach('file', tmpFile)
            .expect(200);
        const dstPad = await padManager.getPad(dstPadId);
        const lines = dstPad.text().split('\n');
        // Each block must land on its own line (lines may carry an
        // etherpad heading marker prefix like '*' from ep_headings2).
        const findLine = (needle: string) =>
            lines.findIndex((l: string) => l.includes(needle));
        const iWelcome = findLine('Welcome');
        const iThisPad = findLine('This pad');
        const iCode = findLine('Code line');
        assert.notStrictEqual(iWelcome, -1,
            `expected "Welcome" on its own line: ${JSON.stringify(lines)}`);
        assert.notStrictEqual(iThisPad, -1,
            `expected "This pad" on its own line: ${JSON.stringify(lines)}`);
        assert.notStrictEqual(iCode, -1,
            `expected "Code line" on its own line: ${JSON.stringify(lines)}`);
        assert.ok(iWelcome !== iThisPad && iThisPad !== iCode,
            `headings/code merged into the same line: ${JSON.stringify(lines)}`);
      } finally {
        await fs.unlink(tmpFile).catch(() => undefined);
      }
    });

    it('preserves text content through native PDF export (sanity check)', async () => {
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
