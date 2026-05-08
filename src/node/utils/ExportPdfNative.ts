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
}

const HEADING_SIZES: Record<string, number> = {
  h1: 24, h2: 20, h3: 16, h4: 14, h5: 12, h6: 11,
};

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

    const top = () => styleStack[styleStack.length - 1];

    const applyFont = () => {
      const s = top();
      const variant =
        s.bold && s.italic ? 'Helvetica-BoldOblique' :
        s.bold ? 'Helvetica-Bold' :
        s.italic ? 'Helvetica-Oblique' :
        'Helvetica';
      doc.font(variant);
      doc.fontSize(s.fontSize || 11);
    };

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
      doc.text(raw, opts);
    };

    const flushLine = () => {
      doc.text('', {continued: false});
    };

    const parser = new Parser({
      onopentag(name, attribs) {
        const cur = top();
        const next: InlineState = {...cur};
        switch (name) {
          case 'b': case 'strong': next.bold = true; break;
          case 'i': case 'em': next.italic = true; break;
          case 'u': next.underline = true; break;
          case 's': case 'strike': case 'del': next.strike = true; break;
          case 'a': next.link = attribs.href; next.underline = true; break;
          case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
            next.fontSize = HEADING_SIZES[name];
            next.bold = true;
            if (!pendingNewline) flushLine();
            doc.moveDown(0.5);
            break;
          case 'p': case 'div':
            if (!pendingNewline) flushLine();
            doc.moveDown(0.3);
            break;
          case 'ul': case 'ol':
            listType.push(name as 'ul' | 'ol');
            listIndex.push(0);
            flushLine();
            break;
          case 'li': {
            flushLine();
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
            flushLine();
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
        writeText(text);
      },

      onclosetag(name) {
        switch (name) {
          case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          case 'p': case 'div':
            flushLine();
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
