'use strict';

import {MapArrayType} from "../../../node/types/MapType";

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
import settings from '../../../node/utils/Settings';

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
    // With soffice configured but pointing at a binary that fails, the
    // legacy convert path errors and the route returns 500. .doc has no
    // native fallback (it stays soffice-only), so this exercises the
    // soffice error path even after #7538.
    settings.soffice = '/bin/false';
    await agent.get('/p/testExportPad/export/doc')
        .expect(500);
  });

  // Issue #7538: in-process DOCX export via html-to-docx bypasses the
  // soffice requirement entirely. A deployment with `soffice: null`
  // should still produce a working .docx via the native path.
  describe('native DOCX export (#7538)', function () {
    before(function () {
      // The upgrade-from-latest-release CI job installs deps from the
      // PREVIOUS release's package.json (before this PR adds html-to-docx)
      // and then git-checkouts this branch's code without re-running
      // `pnpm install`. Under that workflow the module isn't resolvable.
      // Skip the block in that one case; regular backend tests (which
      // install against this branch's lockfile) still exercise it.
      try {
        require.resolve('html-to-docx');
      } catch {
        this.skip();
        return;
      }
      settings.soffice = null;
    });

    it('returns a valid DOCX archive (PK zip signature)', async function () {
      const res = await agent.get('/p/testExportPad/export/docx')
          .buffer(true)
          .parse((resp: any, callback: any) => {
            const chunks: Buffer[] = [];
            resp.on('data', (chunk: Buffer) => chunks.push(chunk));
            resp.on('end', () => callback(null, Buffer.concat(chunks)));
          })
          .expect(200);
      const body: Buffer = res.body as Buffer;
      assert.ok(body.length > 0, 'DOCX body must not be empty');
      // Word .docx files are ZIP archives — must start with the ZIP local
      // file header signature 0x504b0304 ("PK\x03\x04").
      assert.strictEqual(body[0], 0x50, 'byte 0 (P)');
      assert.strictEqual(body[1], 0x4b, 'byte 1 (K)');
      assert.strictEqual(body[2], 0x03, 'byte 2');
      assert.strictEqual(body[3], 0x04, 'byte 3');
    });

    it('sends the Word-processing-ml content-type', async function () {
      const res = await agent.get('/p/testExportPad/export/docx').expect(200);
      assert.match(res.headers['content-type'],
          /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/,
          `unexpected content-type: ${res.headers['content-type']}`);
    });
  });

  describe('native PDF export (#7538)', function () {
    before(function () {
      try {
        require.resolve('pdfkit');
        require.resolve('htmlparser2');
      } catch {
        this.skip();
        return;
      }
      settings.soffice = null;
    });

    it('returns a valid %PDF- document', async function () {
      const res = await agent.get('/p/testExportPad/export/pdf')
          .buffer(true)
          .parse((resp: any, callback: any) => {
            const chunks: Buffer[] = [];
            resp.on('data', (chunk: Buffer) => chunks.push(chunk));
            resp.on('end', () => callback(null, Buffer.concat(chunks)));
          })
          .expect(200);
      const body: Buffer = res.body as Buffer;
      assert.ok(body.length > 200, 'PDF body must be non-trivial');
      assert.strictEqual(body.slice(0, 5).toString('ascii'), '%PDF-');
    });

    it('sends application/pdf content-type', async function () {
      const res = await agent.get('/p/testExportPad/export/pdf').expect(200);
      assert.match(res.headers['content-type'], /application\/pdf/);
    });
  });

  describe('odt without soffice (#7538)', function () {
    before(function () { settings.soffice = null; });
    it('returns the "not enabled" message for odt', async function () {
      const res = await agent.get('/p/testExportPad/export/odt').expect(200);
      assert.match(res.text, /This export is not enabled/);
    });
  });

  describe('stripRemoteImages', function () {
    const {stripRemoteImages} = require('../../../node/utils/ExportSanitizeHtml');

    it('keeps data: URIs', function () {
      const out = stripRemoteImages(
          '<p>x</p><img src="data:image/png;base64,iVBORw0KGgo=">');
      assert.match(out, /<img[^>]+src="data:image\/png/);
    });

    it('keeps relative URLs', function () {
      const out = stripRemoteImages('<img src="/foo/bar.png">');
      assert.match(out, /<img[^>]+src="\/foo\/bar\.png"/);
    });

    it('drops absolute http(s) URLs and falls back to alt', function () {
      const out = stripRemoteImages(
          '<p>before<img src="https://evil.example/x.png" alt="cat">after</p>');
      assert.doesNotMatch(out, /evil\.example/);
      assert.match(out, /before/);
      assert.match(out, /cat/);
      assert.match(out, /after/);
    });

    it('drops protocol-relative URLs', function () {
      const out = stripRemoteImages('<img src="//evil.example/x.png">');
      assert.doesNotMatch(out, /evil\.example/);
    });

    it('passes non-image markup through unchanged', function () {
      const html = '<h1>hi</h1><p>body <a href="/x">link</a></p>';
      assert.strictEqual(stripRemoteImages(html), html);
    });
  });

  describe('extractBody', function () {
    const {extractBody} = require('../../../node/utils/ExportSanitizeHtml');

    it('returns trimmed body content from a full document', function () {
      const html = `<!doctype html><html><head><style>.x{color:red}</style></head><body>
hello<br>world
</body></html>`;
      assert.strictEqual(extractBody(html), 'hello<br>world');
    });

    it('passes a body-less fragment through unchanged', function () {
      const html = '<p>just a fragment</p>';
      assert.strictEqual(extractBody(html), html);
    });

    it('drops <head><style> contents', function () {
      const html = '<html><head><style>.x{}</style></head><body><p>kept</p></body></html>';
      const out = extractBody(html);
      assert.doesNotMatch(out, /style/);
      assert.doesNotMatch(out, /\.x/);
      assert.match(out, /kept/);
    });
  });

  describe('wrapLooseLines', function () {
    const {wrapLooseLines} = require('../../../node/utils/ExportSanitizeHtml');

    it('wraps loose text in <p>', function () {
      assert.strictEqual(wrapLooseLines('Hello'), '<p>Hello</p>');
    });

    it('keeps single <br> as soft break inside one paragraph', function () {
      assert.strictEqual(wrapLooseLines('A<br>B'), '<p>A<br>B</p>');
    });

    it('splits paragraphs on consecutive <br>', function () {
      // Two <br>s between content: one paragraph break + one empty
      // <p></p> marker so the blank pad line survives a DOCX round-trip
      // through html-to-docx and mammoth.
      assert.strictEqual(wrapLooseLines('A<br><br>B'),
          '<p>A</p><p></p><p>B</p>');
    });

    it('emits more empty <p> markers for longer <br> runs', function () {
      // Three <br>s = 2 blank pad lines between content.
      assert.strictEqual(wrapLooseLines('A<br><br><br>B'),
          '<p>A</p><p></p><p></p><p>B</p>');
    });

    it('drops trailing <br>', function () {
      assert.strictEqual(wrapLooseLines('Foo<br>'), '<p>Foo</p>');
    });

    it('leaves block elements alone', function () {
      const html = '<ul><li>x</li></ul>';
      assert.strictEqual(wrapLooseLines(html), html);
    });

    it('handles realistic etherpad pad HTML', function () {
      const out = wrapLooseLines(
          'Welcome!<br><br>Body text.<br>More text.<br>');
      // <br><br> -> blank-line marker between Welcome and Body text;
      // single <br> in the second chunk stays as a soft break;
      // trailing <br> is dropped.
      assert.strictEqual(out,
          '<p>Welcome!</p><p></p><p>Body text.<br>More text.</p>');
    });
  });

  describe('dropEmptyBlocks', function () {
    const {dropEmptyBlocks} = require('../../../node/utils/ExportSanitizeHtml');

    it('drops empty heading blocks', function () {
      const out = dropEmptyBlocks(
          "<h1 style='text-align:right'>Hi</h1><br><h1 style='text-align:right'></h1><br>x");
      assert.strictEqual(out, "<h1 style='text-align:right'>Hi</h1><br><br>x");
    });

    it('drops empty code blocks', function () {
      assert.strictEqual(dropEmptyBlocks('<code></code>x'), 'x');
      assert.strictEqual(
          dropEmptyBlocks('<code style="x">  \n\t  </code>x'), 'x');
    });

    it('iterates so nested empties are dropped too', function () {
      // <code></code> inside a <div> -> div becomes empty -> div drops too.
      // (<p></p> is preserved on purpose; wrapLooseLines uses it as a
      // blank-line marker for DOCX round-trip fidelity.)
      const out = dropEmptyBlocks('<div><code></code></div>after');
      assert.strictEqual(out, 'after');
    });

    it('does not drop empty <p></p> (blank-line marker)', function () {
      const out = dropEmptyBlocks('<p>x</p><p></p><p>y</p>');
      assert.strictEqual(out, '<p>x</p><p></p><p>y</p>');
    });

    it('keeps non-empty blocks unchanged', function () {
      const html = '<h1>Hi</h1><p>body</p><code>x = 1</code>';
      assert.strictEqual(dropEmptyBlocks(html), html);
    });
  });

  describe('separateAdjacentHeadingBlocks', function () {
    const {separateAdjacentHeadingBlocks} =
        require('../../../node/utils/ExportSanitizeHtml');

    it('inserts <br> between adjacent <h1> and <h2>', function () {
      assert.strictEqual(
          separateAdjacentHeadingBlocks('<h1>A</h1><h2>B</h2>'),
          '<h1>A</h1><br><h2>B</h2>');
    });

    it('inserts <br> between adjacent <code> blocks', function () {
      assert.strictEqual(
          separateAdjacentHeadingBlocks('<code>A</code><code>B</code>'),
          '<code>A</code><br><code>B</code>');
    });

    it('inserts <br> after a heading before a <p>', function () {
      assert.strictEqual(
          separateAdjacentHeadingBlocks('<h1>A</h1><p>B</p>'),
          '<h1>A</h1><br><p>B</p>');
    });

    it('does not change adjacent <p> elements', function () {
      const html = '<p>A</p><p>B</p>';
      assert.strictEqual(separateAdjacentHeadingBlocks(html), html);
    });

    it('handles three-block round-trip case', function () {
      // Mirrors what mammoth produces for a pad with H1 + H2 + Code.
      assert.strictEqual(
          separateAdjacentHeadingBlocks(
              '<h1>Welcome</h1><h2>This pad</h2><p>Code line</p>'),
          '<h1>Welcome</h1><br><h2>This pad</h2><br><p>Code line</p>');
    });
  });

  describe('applyMonospaceToCode', function () {
    const {applyMonospaceToCode} =
        require('../../../node/utils/ExportSanitizeHtml');

    it('emits a Courier span for inline <code>', function () {
      // The <code> tag itself is dropped (html-to-docx ignores it and
      // also breaks <a> children when they're nested inside it). The
      // text becomes a Courier-styled inline span.
      const out = applyMonospaceToCode('<code>x = 1</code>');
      assert.strictEqual(out,
          `<span style="font-family:'Courier New', monospace">x = 1</span>`);
    });

    it('forwards block-level style to a wrapping <p>', function () {
      // ep_headings2 + ep_align emit `<code style='text-align:right'>`
      // for each "Code"-styled pad line. The alignment must reach
      // html-to-docx as a paragraph property, so we move the style
      // onto a wrapping <p>.
      const out = applyMonospaceToCode("<code style='text-align:right'>x</code>");
      assert.match(out, /<p style="text-align:right">/);
      assert.match(out, /font-family:'Courier New'/);
    });

    it('emits <p> wrap for <pre> regardless of style', function () {
      // <pre> is always block-level.
      const out = applyMonospaceToCode('<pre>preformatted</pre>');
      assert.match(out, /^<p>/);
      assert.match(out, /<\/p>$/);
      assert.match(out, /font-family:'Courier New'/);
    });

    it('handles inline <tt>, <kbd>, <samp> as bare spans', function () {
      for (const tag of ['tt', 'kbd', 'samp']) {
        const out = applyMonospaceToCode(`<${tag}>x</${tag}>`);
        assert.strictEqual(out,
            `<span style="font-family:'Courier New', monospace">x</span>`,
            `expected styled span (no ${tag} wrapper) but got: ${out}`);
      }
    });

    it('does not touch unrelated tags', function () {
      const html = '<p>plain</p><strong>bold</strong>';
      assert.strictEqual(applyMonospaceToCode(html), html);
    });

    it('does not wrap <a> elements in the Courier span', function () {
      // Regression: html-to-docx drops <a href> content when nested
      // inside a styled span OR inside <code>. We split on anchors
      // and leave them unstyled.
      const out = applyMonospaceToCode(
          '<code>Github: <a href="https://github.com/ether/etherpad">link</a> end</code>');
      // Anchor is preserved as-is (no Courier span around it)
      assert.match(out, /<a href="https:\/\/github\.com\/ether\/etherpad">link<\/a>/);
      // Text before the anchor is wrapped
      assert.match(out, /font-family:'Courier New', monospace">Github: <\/span>/);
      // Text after the anchor is wrapped
      assert.match(out, /font-family:'Courier New', monospace"> end<\/span>/);
      // <code> wrapper is dropped
      assert.doesNotMatch(out, /<code/);
      assert.doesNotMatch(out, /<\/code>/);
    });

    it('preserves <a> through html-to-docx round-trip', async function () {
      try { require.resolve('html-to-docx'); }
      catch { this.skip(); return; }
      const htmlToDocx = require('html-to-docx');
      const JSZip = require('jszip');
      const buf: Buffer = await htmlToDocx(applyMonospaceToCode(
          '<p><code>Github: <a href="https://github.com/ether/etherpad">site</a></code></p>'));
      const z = await JSZip.loadAsync(buf);
      const xml: string = await z.file('word/document.xml').async('text');
      // Anchor must survive: docx hyperlinks live in <w:hyperlink>
      assert.match(xml, /<w:hyperlink/, 'expected <w:hyperlink> in docx');
      assert.match(xml, /<w:t[^>]*>site<\/w:t>/, 'expected link text "site"');
      const rels: string = await z.file('word/_rels/document.xml.rels')
          .async('text');
      assert.match(rels, /github\.com\/ether\/etherpad/,
          'expected URL in document.xml.rels');
    });
  });

  describe('htmlToPdfBuffer', function () {
    let htmlToPdfBuffer: (html: string) => Promise<Buffer>;

    before(function () {
      try {
        require.resolve('pdfkit');
        require.resolve('htmlparser2');
      } catch {
        this.skip();
        return;
      }
      htmlToPdfBuffer = require('../../../node/utils/ExportPdfNative').htmlToPdfBuffer;
    });

    it('produces a buffer starting with %PDF-', async function () {
      const buf = await htmlToPdfBuffer('<p>hello world</p>');
      assert.ok(Buffer.isBuffer(buf), 'must return Buffer');
      assert.ok(buf.length > 100, `buffer suspiciously small: ${buf.length} bytes`);
      assert.strictEqual(buf.slice(0, 5).toString('ascii'), '%PDF-');
    });

    // pdfkit emits visible text as hex strings inside TJ operators
    // (e.g. `Title` -> `<5469746c65>`), and pdfkit splits a single text
    // run into multiple chunks at kerning boundaries. Decode every hex
    // string we find and concatenate the result so substring matching
    // works on the visible text content.
    const decodeVisibleText = (raw: string): string => {
      const out: string[] = [];
      const re = /<([0-9a-fA-F]{2,})>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw)) !== null) {
        try {
          out.push(Buffer.from(m[1], 'hex').toString('latin1'));
        } catch { /* not hex; ignore */ }
      }
      return out.join('');
    };

    const renderText = async (html: string): Promise<string> => {
      const buf = await htmlToPdfBuffer(html);
      return buf.toString('latin1');
    };

    it('renders headings, paragraphs, and lists', async function () {
      const raw = await renderText(`
        <h1>Title</h1>
        <p>Body paragraph here.</p>
        <ul><li>one</li><li>two</li></ul>
        <ol><li>alpha</li><li>beta</li></ol>
      `);
      const visible = decodeVisibleText(raw);
      assert.ok(visible.includes('Title'), `expected Title in: ${visible}`);
      assert.ok(visible.includes('Body paragraph here.'),
          `expected paragraph in: ${visible}`);
      assert.ok(visible.includes('one'), `expected "one" in: ${visible}`);
      assert.ok(visible.includes('two'), `expected "two" in: ${visible}`);
      assert.ok(visible.includes('alpha'), `expected "alpha" in: ${visible}`);
      assert.ok(visible.includes('beta'), `expected "beta" in: ${visible}`);
    });

    it('emits link annotations for <a href>', async function () {
      const raw = await renderText('<p><a href="https://etherpad.org">site</a></p>');
      const visible = decodeVisibleText(raw);
      assert.ok(visible.includes('site'), `expected "site" in: ${visible}`);
      // URL is stored in a /URI dict as a plain (parenthesized) string.
      // Match the full /URI (...) form so we're verifying the PDF link
      // annotation structure, not just any occurrence of the host string.
      assert.match(raw, /\/URI\s*\(https:\/\/etherpad\.org\)/,
          'expected link target URL in PDF /URI dict');
    });

    it('embeds data: URI images without throwing', async function () {
      const tinyPng =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      const buf = await htmlToPdfBuffer(`<img src="data:image/png;base64,${tinyPng}">`);
      assert.ok(buf.length > 200);
    });

    it('ignores unknown tags rather than crashing', async function () {
      const buf = await htmlToPdfBuffer(
          '<custom-tag><p>still works</p></custom-tag>');
      assert.strictEqual(buf.slice(0, 5).toString('ascii'), '%PDF-');
    });

    it('does not render head/style/script content', async function () {
      const raw = await renderText(`
        <html><head>
          <title>SECRET_TITLE</title>
          <style>.x { display: SECRET_CSS; }</style>
          <script>var SECRET_JS = 1;</script>
        </head><body>
          <p>visible body</p>
        </body></html>
      `);
      const visible = decodeVisibleText(raw);
      assert.doesNotMatch(visible, /SECRET_TITLE/);
      assert.doesNotMatch(visible, /SECRET_CSS/);
      assert.doesNotMatch(visible, /SECRET_JS/);
      assert.match(visible, /visible body/);
    });

    it('honors text-align style on block elements', async function () {
      // pdfkit emits text-positioning matrices for aligned text. We assert
      // the alignment option produced different output than left-aligned
      // by checking the x coordinate of the BT block.
      const leftRaw = await renderText('<p>aligned text</p>');
      const rightRaw = await renderText('<p style="text-align:right">aligned text</p>');
      const leftX = (leftRaw.match(/1 0 0 1 (\d+(?:\.\d+)?)/) || [])[1];
      const rightX = (rightRaw.match(/1 0 0 1 (\d+(?:\.\d+)?)/) || [])[1];
      assert.ok(leftX, 'expected left x');
      assert.ok(rightX, 'expected right x');
      assert.notStrictEqual(leftX, rightX,
          `right-aligned text should sit at a different x than left-aligned (left=${leftX} right=${rightX})`);
    });

    it('uses Courier font inside <code>', async function () {
      const raw = await renderText('<p>before <code>x = 1</code> after</p>');
      // pdfkit references the font in the resource dictionary; Courier
      // isn't in the default resources so its first use creates a new
      // /Font subtype entry. Look for "Courier" anywhere in the PDF.
      assert.match(raw, /Courier/);
    });

    it('uses Courier font inside <pre>', async function () {
      const raw = await renderText('<pre>preformatted text</pre>');
      assert.match(raw, /Courier/);
    });

    it('honors text-align on <code> (ep_headings2 code lines)', async function () {
      const leftRaw = await renderText('<code>x = 1</code>');
      const rightRaw = await renderText("<code style='text-align:right'>x = 1</code>");
      const leftX = (leftRaw.match(/1 0 0 1 (\d+(?:\.\d+)?)/) || [])[1];
      const rightX = (rightRaw.match(/1 0 0 1 (\d+(?:\.\d+)?)/) || [])[1];
      assert.ok(leftX, 'expected left x');
      assert.ok(rightX, 'expected right x');
      assert.notStrictEqual(leftX, rightX,
          `right-aligned <code> should sit at a different x than left-aligned (left=${leftX} right=${rightX})`);
    });

    it('honors text-align on <pre>', async function () {
      const leftRaw = await renderText('<pre>x = 1</pre>');
      const rightRaw = await renderText("<pre style='text-align:right'>x = 1</pre>");
      const leftX = (leftRaw.match(/1 0 0 1 (\d+(?:\.\d+)?)/) || [])[1];
      const rightX = (rightRaw.match(/1 0 0 1 (\d+(?:\.\d+)?)/) || [])[1];
      assert.notStrictEqual(leftX, rightX,
          `right-aligned <pre> should sit at a different x than left-aligned (left=${leftX} right=${rightX})`);
    });
  });
});
