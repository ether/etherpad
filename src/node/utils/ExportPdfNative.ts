'use strict';

import {Parser} from 'htmlparser2';
import {PassThrough} from 'stream';
import fs from 'fs';
import path from 'path';

const log4js = require('log4js');
const logger = log4js.getLogger('ExportPdfNative');

const PDFDocument = require('pdfkit');

interface InlineState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  link?: string;
  fontSize?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  // Resolved font family key: a built-in key ('helvetica' | 'times' |
  // 'courier') or the normalised name of an operator-configured font.
  // Undefined means "whatever the document default is" (Helvetica), which
  // keeps output byte-identical for pads that use no font styling.
  fontFamily?: string;
}

// ---------------------------------------------------------------------------
// Font handling
//
// pdfkit ships the PDF "standard 14" fonts, which cover three families
// (Helvetica, Times, Courier) with regular/bold/italic/bold-italic variants
// and need no font files on disk. Everything else has to be registered from
// a TTF/OTF, which Etherpad cannot do out of the box without bundling font
// files (a licensing decision, not a technical one), so operators opt in via
// the `exportPdfFonts` setting.
//
// The mapping below therefore resolves a CSS font-family list to one of the
// three built-ins by *category* (sans-serif / serif / monospace). A pad that
// uses Garamond renders as Times rather than Helvetica: not the exact face,
// but the right kind of face, which is what makes the export readable and
// what today's export loses entirely.
//
// SECURITY: the family names that reach here come from pad content (plugins
// such as ep_font_family emit `<span style="font-family:...">` via
// getLineHTMLForExport), so nothing from the HTML is ever used as a file
// path or passed to pdfkit verbatim. A family name is normalised and looked
// up in an allow-list; a miss simply inherits the enclosing font. Only
// `exportPdfFonts`, which is operator-controlled, can name a file.
// ---------------------------------------------------------------------------

type FontVariant = 'regular' | 'bold' | 'italic' | 'boldItalic';
type BuiltinKey = 'helvetica' | 'times' | 'courier';

const BUILTIN_FONTS: Record<BuiltinKey, Record<FontVariant, string>> = {
  helvetica: {
    regular: 'Helvetica',
    bold: 'Helvetica-Bold',
    italic: 'Helvetica-Oblique',
    boldItalic: 'Helvetica-BoldOblique',
  },
  times: {
    regular: 'Times-Roman',
    bold: 'Times-Bold',
    italic: 'Times-Italic',
    boldItalic: 'Times-BoldItalic',
  },
  courier: {
    regular: 'Courier',
    bold: 'Courier-Bold',
    italic: 'Courier-Oblique',
    boldItalic: 'Courier-BoldOblique',
  },
};

// Does this family name have a built-in? Uses hasOwnProperty because the
// name being looked up comes from pad content, and a plain `in` check would
// happily report a hit for 'constructor', 'toString', etc.
const builtinFor = (name: string): BuiltinKey | undefined =>
  (Object.prototype.hasOwnProperty.call(BUILTIN_FONTS, name)
      ? name as BuiltinKey
      : undefined);

// CSS family name (normalised by normalizeFamilyName) -> built-in family.
// Null-prototype for the same reason as builtinFor(). Generic CSS families
// come first, then the widely used concrete faces grouped by the built-in
// that best approximates them.
const CSS_FAMILY_TO_BUILTIN: Record<string, BuiltinKey> = Object.create(null);
const mapFamilies = (key: BuiltinKey, names: string[]) => {
  for (const n of names) CSS_FAMILY_TO_BUILTIN[n] = key;
};

mapFamilies('helvetica', [
  // generic
  'sans serif', 'sans', 'system ui', 'ui sans serif', 'fantasy',
  // concrete
  'helvetica', 'helvetica neue', 'arial', 'arial black', 'arial narrow',
  'liberation sans', 'nimbus sans', 'freesans', 'verdana', 'tahoma',
  'trebuchet ms', 'segoe ui', 'calibri', 'candara', 'geneva', 'avant garde',
  'century gothic', 'futura', 'gill sans', 'lucida grande', 'lucida sans',
  'lucida sans unicode', 'dejavu sans', 'noto sans', 'open sans', 'roboto',
  'lato', 'ubuntu', 'franklin gothic medium', 'impact', 'optima', 'inter',
]);

mapFamilies('times', [
  // generic
  'serif', 'ui serif', 'cursive',
  // concrete
  'times', 'times new roman', 'liberation serif', 'nimbus roman', 'freeserif',
  'georgia', 'garamond', 'eb garamond', 'palatino', 'palatino linotype',
  'book antiqua', 'bookman', 'bookman old style', 'itc bookman',
  'century schoolbook', 'new century schoolbook', 'cambria', 'constantia',
  'baskerville', 'didot', 'hoefler text', 'dejavu serif', 'noto serif',
  'pt serif', 'merriweather', 'charter', 'utopia', 'rockwell',
]);

mapFamilies('courier', [
  // generic
  'monospace', 'mono', 'ui monospace',
  // concrete
  'courier', 'courier new', 'liberation mono', 'nimbus mono', 'freemono',
  'consolas', 'monaco', 'menlo', 'andale mono', 'lucida console',
  'dejavu sans mono', 'noto sans mono', 'roboto mono', 'source code pro',
  'fira code', 'fira mono', 'ibm plex mono', 'inconsolata', 'pt mono',
  'sf mono', 'cascadia code', 'cascadia mono', 'jetbrains mono',
  'ubuntu mono',
]);

// Lowercase, unquote, and treat hyphens/underscores/whitespace runs as a
// single space so that both real CSS (`"Times New Roman"`) and the tag-ish
// names plugins generate (`times-new-roman`) land on the same key.
export const normalizeFamilyName = (raw: string): string =>
  raw.trim()
      .replace(/^["']|["']$/g, '')
      .toLowerCase()
      .replace(/[\s_-]+/g, ' ')
      .trim();

// Pull the value of the `font-family` declaration out of a style attribute.
// Anchored on a declaration boundary so `-font-family` or a value containing
// the text cannot match.
const FONT_FAMILY_DECL_RE = /(?:^|;)\s*font-family\s*:\s*([^;]+)/gi;
const IMPORTANT_RE = /\s*!\s*important\s*$/i;

export const parseFontFamily = (style: string | undefined): string[] => {
  if (!style) return [];
  // A style attribute may carry the declaration more than once. CSS resolves
  // that by taking the last one, except that an `!important` declaration
  // beats any later non-important one, so track both candidates. The
  // `!important` flag itself is stripped before the value is normalised —
  // otherwise the lookup key would be `serif !important` and match nothing.
  let last: string | undefined;
  let lastImportant: string | undefined;
  FONT_FAMILY_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FONT_FAMILY_DECL_RE.exec(style)) !== null) {
    const raw = m[1];
    const value = raw.replace(IMPORTANT_RE, '');
    if (value !== raw) lastImportant = value;
    last = value;
  }
  const winner = lastImportant !== undefined ? lastImportant : last;
  if (winner === undefined) return [];
  return winner.split(',').map(normalizeFamilyName).filter((s) => s !== '');
};

export interface PdfFontFiles {
  regular?: string;
  bold?: string;
  italic?: string;
  boldItalic?: string;
  // Built-in family to use when a file is missing or unreadable.
  fallback?: BuiltinKey;
}

export type PdfFontConfig = Record<string, string | PdfFontFiles>;

// Normalise the operator-supplied `exportPdfFonts` map once: keys go through
// the same normalisation as CSS family names, a bare string is treated as the
// regular face, and relative paths resolve against the Etherpad root.
const normalizeFontConfig = (raw: unknown, root: string): Map<string, PdfFontFiles> => {
  const out = new Map<string, PdfFontFiles>();
  if (!raw || typeof raw !== 'object') return out;
  for (const [family, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeFamilyName(family);
    if (!key) continue;
    const files: PdfFontFiles = {};
    const resolve = (p: unknown) =>
      (typeof p === 'string' && p !== '' ? path.resolve(root, p) : undefined);
    if (typeof value === 'string') {
      files.regular = resolve(value);
    } else if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      files.regular = resolve(v.regular);
      files.bold = resolve(v.bold);
      files.italic = resolve(v.italic);
      files.boldItalic = resolve(v.boldItalic);
      const fb = typeof v.fallback === 'string'
        ? builtinFor(normalizeFamilyName(v.fallback))
        : undefined;
      if (fb) files.fallback = fb;
    }
    if (!files.regular) continue;  // nothing usable
    out.set(key, files);
  }
  return out;
};

let cachedConfigSource: unknown;
let cachedConfig: Map<string, PdfFontFiles> = new Map();

const getFontConfig = (): Map<string, PdfFontFiles> => {
  let raw: unknown;
  let root = '.';
  try {
    const settings = require('./Settings');
    raw = settings.exportPdfFonts;
    if (typeof settings.root === 'string') root = settings.root;
  } catch {
    return new Map();
  }
  if (raw !== cachedConfigSource) {
    cachedConfigSource = raw;
    cachedConfig = normalizeFontConfig(raw, root);
  }
  return cachedConfig;
};

// Font files are read once per process; a pad export can reference the same
// family hundreds of times and every PDFDocument needs its own registration.
// The cache is keyed by the file's mtime and size as well as its path, so
// replacing a font in place — or dropping in one whose path was previously
// wrong — takes effect on the next export without restarting Etherpad.
// Failures are deliberately not cached, for the same reason.
const fontFileCache = new Map<string, {stamp: string, buf: Buffer}>();

const readFontFile = (file: string): Buffer | null => {
  let stamp: string;
  try {
    const st = fs.statSync(file);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch (err) {
    logger.warn(`PDF export: cannot read font file "${file}": ${(err as Error).message}`);
    fontFileCache.delete(file);
    return null;
  }
  const cached = fontFileCache.get(file);
  if (cached && cached.stamp === stamp) return cached.buf;
  let buf: Buffer;
  try {
    buf = fs.readFileSync(file);
  } catch (err) {
    logger.warn(`PDF export: cannot read font file "${file}": ${(err as Error).message}`);
    fontFileCache.delete(file);
    return null;
  }
  fontFileCache.set(file, {stamp, buf});
  return buf;
};

export const exportedForTesting = {
  normalizeFamilyName,
  parseFontFamily,
  BUILTIN_FONTS,
  CSS_FAMILY_TO_BUILTIN,
  clearFontCache: () => {
    fontFileCache.clear();
    cachedConfigSource = undefined;
    cachedConfig = new Map();
  },
};

// Resolve a CSS font-family list (already normalised) to a family key this
// renderer can draw with. Operator-registered families win over the built-in
// mapping so an install that has a real Arial file can use it. Returns
// undefined when nothing in the list is known, so the enclosing font is
// inherited instead.
const resolveFamilyList = (candidates: string[]): string | undefined => {
  const configured = getFontConfig();
  for (const name of candidates) {
    if (configured.has(name)) return name;
    const builtin = CSS_FAMILY_TO_BUILTIN[name];
    if (builtin) return builtin;
  }
  return undefined;
};

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

    // Operator-registered fonts are read once per process but have to be
    // registered with every PDFDocument, so track what this document has.
    const configuredFonts = getFontConfig();
    const registered = new Set<string>();
    const failed = new Set<string>();

    // Resolve a (family, variant) pair to a font name this document can use,
    // registering the operator-supplied font file on first use. Every failure
    // path degrades to a built-in font: a missing or corrupt font file must
    // never fail an export.
    const pdfFontFor = (
      family: string | undefined,
      variant: FontVariant,
    ): {name: string, fallback: string} => {
      const key = family || 'helvetica';
      const builtinKey = builtinFor(key);
      if (builtinKey) {
        const name = BUILTIN_FONTS[builtinKey][variant];
        return {name, fallback: name};
      }
      const files = configuredFonts.get(key);
      const fallbackKey = files && files.fallback ? files.fallback : 'helvetica';
      const fallback = BUILTIN_FONTS[fallbackKey][variant];
      if (!files) return {name: fallback, fallback};
      const regName = `ep-${key}-${variant}`;
      if (failed.has(regName)) return {name: fallback, fallback};
      if (!registered.has(regName)) {
        const file = files[variant] || files.regular;
        const buf = file ? readFontFile(file) : null;
        if (!buf) {
          failed.add(regName);
          return {name: fallback, fallback};
        }
        try {
          doc.registerFont(regName, buf);
        } catch (err) {
          logger.warn(`PDF export: cannot register font "${key}": ${(err as Error).message}`);
          failed.add(regName);
          return {name: fallback, fallback};
        }
        registered.add(regName);
      }
      return {name: regName, fallback};
    };

    const applyFont = () => {
      const s = top();
      const variant: FontVariant =
        s.bold && s.italic ? 'boldItalic' :
        s.bold ? 'bold' :
        s.italic ? 'italic' :
        'regular';
      const {name, fallback} = pdfFontFor(s.fontFamily, variant);
      try {
        doc.font(name);
      } catch (err) {
        // The font file only gets parsed when it is first selected, so a
        // malformed TTF/OTF surfaces here rather than at registerFont().
        logger.warn(`PDF export: cannot embed font "${name}": ${(err as Error).message}`);
        failed.add(name);
        doc.font(fallback);
      }
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
            next.fontFamily = 'courier';
            // ep_headings2 uses <code style='text-align:...'> as a block-
            // styled "code" line, so read the alignment off the opening
            // tag too. parseAlign returns undefined when no text-align
            // is set, so this is a no-op for inline <code> usage.
            const a = parseAlign(attribs.style);
            if (a) next.align = a;
            break;
          }
          case 'pre': {
            next.fontFamily = 'courier';
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
        // An explicit font-family wins over the tag's own default, so read it
        // after the switch. ep_font_family rewrites its attributes into
        // `<span style="font-family:...">` in getLineHTMLForExport; plugins
        // that use exportHtmlAdditionalTagsWithData instead emit
        // `<span data-font-family="...">`, so accept both.
        //
        // A family that resolves to nothing leaves the font untouched, i.e.
        // whatever this element would have used anyway: the enclosing font
        // for ordinary elements, and Courier for `code`/`pre`/`tt`/`kbd`/
        // `samp`, which is deliberate — an unreadable font name is no reason
        // to render code in a proportional face.
        const styleFamily = resolveFamilyList(parseFontFamily(attribs.style));
        if (styleFamily) {
          next.fontFamily = styleFamily;
        } else {
          const dataFamily = attribs['data-font-family'] || attribs['data-font'];
          if (dataFamily) {
            const resolved = resolveFamilyList(
                dataFamily.split(',').map(normalizeFamilyName).filter((n) => n !== ''));
            if (resolved) next.fontFamily = resolved;
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
