'use strict';

import {Parser} from 'htmlparser2';

// Pull `<body>...</body>` out of a full HTML document. Etherpad's
// `getPadHTMLDocument()` returns a complete page — `<head>` with a `<style>`
// block, doctype, etc. The legacy LibreOffice path renders that fine, but
// the in-process converters (html-to-docx, our pdfkit walker) treat
// non-body content as renderable, leaking CSS into the output and giving
// blank-line issues from the leading whitespace inside `<body>`. This helper
// extracts the body content and trims surrounding whitespace; if the input
// has no `<body>`, it's returned unchanged so plugin-shaped fragments still
// flow through.
const BODY_RE = /<body[^>]*>([\s\S]*?)<\/body>/i;
export const extractBody = (html: string): string => {
  const m = BODY_RE.exec(html);
  if (!m) return html;
  return m[1].replace(/^[\s ]+/, '').replace(/[\s ]+$/, '');
};

// Wrap loose text + inline content in `<p>` blocks so html-to-docx renders
// `<br>` as a soft line break (`<w:br/>`) instead of a paragraph break
// (`<w:p>`). Etherpad's HTML export uses bare `<br>` for every line and
// `<br><br>` for blank lines, so without this DOCX exports get one Word
// paragraph per line and two empty paragraphs for every blank line.
//
// Strategy: split the input on runs of `<br>` of length >= 2 (paragraph
// separators), then for each chunk, if it's a recognized block element
// leave it alone, otherwise wrap in `<p>`. Single `<br>` inside a chunk
// stays as a soft break which html-to-docx handles correctly.
const BLOCK_HEAD_RE = /^<(?:p|h[1-6]|ul|ol|table|blockquote|pre|div)[\s>/]/i;
// Anchored so the inner `\s*` can't overlap with surrounding whitespace and
// trigger exponential backtracking. Matches `<br>` followed by at least one
// more `<br>` (with optional whitespace between).
const BR_PARA_RE = /<br\s*\/?>(?:\s*<br\s*\/?>)+/gi;
const TRAILING_BR_RE = /(?:<br\s*\/?>\s*)+$/i;
export const wrapLooseLines = (html: string): string => {
  const chunks = html.split(BR_PARA_RE)
      .map((c) => c.replace(TRAILING_BR_RE, '').trim())
      .filter((c) => c.length > 0);
  return chunks
      .map((c) => (BLOCK_HEAD_RE.test(c) ? c : `<p>${c}</p>`))
      .join('');
};

const isLocalSrc = (src: string): boolean => {
  if (!src) return true;
  if (src.startsWith('data:')) return true;
  if (src.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false;
  return true;
};

const escapeAttr = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const escapeText = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

export const stripRemoteImages = (html: string): string => {
  let out = '';
  const parser = new Parser({
    onopentag(name, attribs) {
      if (name === 'img') {
        const src = attribs.src || '';
        if (isLocalSrc(src)) {
          let tag = '<img';
          for (const [k, v] of Object.entries(attribs)) {
            tag += ` ${k}="${escapeAttr(v)}"`;
          }
          tag += '>';
          out += tag;
        } else {
          out += escapeText(attribs.alt || '');
        }
        return;
      }
      let tag = `<${name}`;
      for (const [k, v] of Object.entries(attribs)) {
        tag += ` ${k}="${escapeAttr(v)}"`;
      }
      tag += '>';
      out += tag;
    },
    ontext(text) {
      out += text;
    },
    onclosetag(name) {
      if (VOID_TAGS.has(name)) return;
      out += `</${name}>`;
    },
  }, {decodeEntities: false, lowerCaseTags: true});
  parser.write(html);
  parser.end();
  return out;
};
