'use strict';

import {Parser} from 'htmlparser2';
import {PassThrough} from 'stream';

const PDFDocument = require('pdfkit');

interface InlineState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  link?: string;
  fontSize?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  mono?: boolean;
}

const parseAlign = (style: string | undefined): InlineState['align'] | undefined => {
  if (!style) return undefined;
  const m = /text-align\s*:\s*(left|center|right|justify)/i.exec(style);
  return m ? (m[1].toLowerCase() as InlineState['align']) : undefined;
};

const HEADING_SIZES: Record<string, number> = {
  h1: 24, h2: 20, h3: 16, h4: 14, h5: 12, h6: 11,
};

// Tags whose text content must never appear in the rendered PDF (CSS,
// scripts, document metadata). The walker maintains a depth counter so that
// nested elements inside one of these are ignored too.
const SKIP_TAGS = new Set(['head', 'style', 'script', 'title', 'meta', 'link', 'noscript']);

const decodeDataUri = (src: string): Buffer | null => {
  const m = /^data:[^;,]+;base64,(.+)$/i.exec(src);
  if (!m) return null;
  try {
    return Buffer.from(m[1], 'base64');
  } catch {
    return null;
  }
};

export const htmlToPdfBuffer = (html: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    // compress:false keeps the content stream uncompressed. Pads are small
    // enough that the size cost is negligible, and it lets ops greppable PDFs
    // out of the box for accessibility / search-engine indexers that don't
    // FlateDecode.
    const doc = new PDFDocument({margin: 50, compress: false});
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    doc.pipe(stream);

    const styleStack: InlineState[] = [{
      bold: false, italic: false, underline: false, strike: false,
    }];
    const listType: ('ul' | 'ol' | null)[] = [];
    const listIndex: number[] = [];
    let pendingNewline = false;
    let skipDepth = 0;

    const top = () => styleStack[styleStack.length - 1];

    const applyFont = () => {
      const s = top();
      let variant: string;
      if (s.mono) {
        variant =
          s.bold && s.italic ? 'Courier-BoldOblique' :
          s.bold ? 'Courier-Bold' :
          s.italic ? 'Courier-Oblique' :
          'Courier';
      } else {
        variant =
          s.bold && s.italic ? 'Helvetica-BoldOblique' :
          s.bold ? 'Helvetica-Bold' :
          s.italic ? 'Helvetica-Oblique' :
          'Helvetica';
      }
      doc.font(variant);
      doc.fontSize(s.fontSize || 11);
    };

    // Track whether the current run started with an alignment override so
    // we apply `align` exactly once per pdfkit text() call (pdfkit uses the
    // align option of the first call in a continued run for the whole line).
    let runStartedAligned = false;

    const writeText = (raw: string) => {
      if (!raw) return;
      if (pendingNewline) {
        doc.moveDown(0.5);
        pendingNewline = false;
      }
      const s = top();
      applyFont();
      const opts: any = {continued: true};
      if (s.underline) opts.underline = true;
      if (s.strike) opts.strike = true;
      if (s.link) opts.link = s.link;
      if (s.align && !runStartedAligned) {
        opts.align = s.align;
        runStartedAligned = true;
      }
      doc.text(raw, opts);
    };

    // End the current `continued: true` text run. pdfkit's `text('', false)`
    // closes the run but does NOT advance the cursor — subsequent text would
    // overlay at the same y. Use `breakLine` whenever a true newline is
    // intended (br, end-of-block, list items).
    const flushLine = () => {
      doc.text('', {continued: false});
      runStartedAligned = false;
    };
    const breakLine = () => {
      flushLine();
      doc.moveDown(1);
    };

    const parser = new Parser({
      onopentag(name, attribs) {
        if (SKIP_TAGS.has(name)) skipDepth += 1;
        if (skipDepth > 0) {
          styleStack.push({...top()});
          return;
        }
        const cur = top();
        const next: InlineState = {...cur};
        switch (name) {
          case 'b': case 'strong': next.bold = true; break;
          case 'i': case 'em': next.italic = true; break;
          case 'u': next.underline = true; break;
          case 's': case 'strike': case 'del': next.strike = true; break;
          case 'a': next.link = attribs.href; next.underline = true; break;
          case 'code': case 'tt': case 'kbd': case 'samp': {
            next.mono = true;
            // ep_headings2 uses <code style='text-align:...'> as a block-
            // styled "code" line, so read the alignment off the opening
            // tag too. parseAlign returns undefined when no text-align
            // is set, so this is a no-op for inline <code> usage.
            const a = parseAlign(attribs.style);
            if (a) next.align = a;
            break;
          }
          case 'pre': {
            next.mono = true;
            const a = parseAlign(attribs.style);
            if (a) next.align = a;
            if (!pendingNewline) breakLine();
            break;
          }
          case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
            next.fontSize = HEADING_SIZES[name];
            next.bold = true;
            const a = parseAlign(attribs.style);
            if (a) next.align = a;
            if (!pendingNewline) breakLine();
            break;
          }
          case 'p': case 'div': {
            const a = parseAlign(attribs.style);
            if (a) next.align = a;
            if (!pendingNewline) breakLine();
            break;
          }
          case 'ul': case 'ol':
            listType.push(name as 'ul' | 'ol');
            listIndex.push(0);
            breakLine();
            break;
          case 'li': {
            breakLine();
            const t = listType[listType.length - 1] || 'ul';
            if (t === 'ol') listIndex[listIndex.length - 1] += 1;
            const prefix = t === 'ul'
              ? '• '
              : `${listIndex[listIndex.length - 1]}. `;
            const indent = '   '.repeat(Math.max(0, listType.length - 1));
            applyFont();
            doc.text(`${indent}${prefix}`, {continued: true});
            break;
          }
          case 'br':
            breakLine();
            break;
          case 'img': {
            const buf = decodeDataUri(attribs.src || '');
            if (buf) {
              flushLine();
              try { doc.image(buf, {fit: [400, 300]}); } catch { /* skip bad image */ }
            }
            break;
          }
        }
        styleStack.push(next);
      },

      ontext(text) {
        if (skipDepth > 0) return;
        // Collapse consecutive whitespace to a single space, the way an
        // HTML renderer would. Without this, literal newlines and tabs in
        // pretty-printed source HTML show up as runs of " " in the PDF.
        const collapsed = text.replace(/[\s ]+/g, ' ');
        if (collapsed === ' ') return;  // pure-whitespace runs are dropped
        writeText(collapsed);
      },

      onclosetag(name) {
        if (skipDepth > 0) {
          if (SKIP_TAGS.has(name)) skipDepth -= 1;
          styleStack.pop();
          if (styleStack.length === 0) {
            styleStack.push({bold: false, italic: false, underline: false, strike: false});
          }
          return;
        }
        switch (name) {
          case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          case 'p': case 'div': case 'pre':
            breakLine();
            pendingNewline = true;
            break;
          case 'li':
            flushLine();
            break;
          case 'ul': case 'ol':
            listType.pop();
            listIndex.pop();
            doc.moveDown(0.3);
            break;
        }
        styleStack.pop();
        if (styleStack.length === 0) {
          styleStack.push({bold: false, italic: false, underline: false, strike: false});
        }
      },
    }, {decodeEntities: true, lowerCaseTags: true});

    parser.write(html);
    parser.end();
    flushLine();
    doc.end();
  });
