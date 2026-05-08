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

// Insert a `<br>` between adjacent heading-style blocks so etherpad's
// server-side content collector breaks them into separate pad lines.
//
// Background: contentcollector's default `_blockElems` set is just
// `{div, p, pre, li}`. ep_headings2 registers the CLIENT-side
// `aceRegisterBlockElements` for `h1..h4` and `code`, but not the
// SERVER-side `ccRegisterBlockElements`, so on import contentcollector
// treats those tags as inline and merges adjacent ones into a single
// line. This helper fires on the IMPORT path (after mammoth produces
// HTML) to forcibly separate them.
const ADJACENT_HEADING_BLOCKS_RE =
  /(<\/(?:h[1-6]|code)>)(\s*<(?:h[1-6]|code|p|pre|div|blockquote|ul|ol)\b)/gi;
export const separateAdjacentHeadingBlocks = (html: string): string =>
    html.replace(ADJACENT_HEADING_BLOCKS_RE, '$1<br>$2');

// Convert code/pre/tt/kbd/samp wrappers to plain styled spans (and a
// wrapping <p> when block-styled) so html-to-docx renders them with
// `<w:rFonts w:ascii="Courier New" .../>`. The bare `<code>` tag
// isn't translated to a font change by html-to-docx, AND it has a
// nasty bug where any `<a href>` nested inside `<code>` (or inside a
// styled `<span>`) is silently dropped from the output. Workaround:
// drop the code/pre tag entirely, wrap non-anchor text in monospace
// spans, leave anchors as-is. For block-level usage (e.g.
// ep_headings2's `<code style='text-align:right'>` per-line wrapper)
// we emit a wrapping `<p>` and forward any text-align style.
//
// Run BEFORE `wrapLooseLines` so the resulting `<p>` lands at the
// loose-line boundary instead of getting double-wrapped.
const MONO_TAGS_RE = /<(code|tt|kbd|samp|pre)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const ANCHOR_RE = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
const STYLE_ATTR_RE = /\bstyle\s*=\s*(['"])([^'"]*)\1/i;
const COURIER_OPEN = '<span style="font-family:\'Courier New\', monospace">';
const COURIER_CLOSE = '</span>';

const wrapNonAnchorSegments = (content: string): string => {
  let out = '';
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(content)) !== null) {
    const before = content.slice(lastIndex, m.index);
    if (before) out += `${COURIER_OPEN}${before}${COURIER_CLOSE}`;
    out += m[0];
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < content.length) {
    const after = content.slice(lastIndex);
    if (after) out += `${COURIER_OPEN}${after}${COURIER_CLOSE}`;
  }
  return out || `${COURIER_OPEN}${content}${COURIER_CLOSE}`;
};

export const applyMonospaceToCode = (html: string): string =>
    html.replace(MONO_TAGS_RE, (_, tag, attrs, content) => {
      const styled = wrapNonAnchorSegments(content);
      // Block-level treatment for <pre> (always) and <code>/<tt>/etc.
      // when the wrapper carries an inline style (ep_headings2 +
      // ep_align emit `<code style='text-align:right'>` for each pad
      // line). Forward the style to a wrapping `<p>`.
      const styleMatch = STYLE_ATTR_RE.exec(attrs);
      if (tag.toLowerCase() === 'pre' || styleMatch) {
        const styleAttr = styleMatch ? ` style="${styleMatch[2]}"` : '';
        return `<p${styleAttr}>${styled}</p>`;
      }
      return styled;
    });

// Drop block elements whose only content is whitespace. Etherpad plugins
// like ep_headings2 emit a heading-styled blank-line block (e.g.
// `<h1 style='text-align:right'></h1>`) after every styled line, which
// turns into an extra empty `<w:p>` in DOCX and an extra blank line in
// PDF. Iterates because removing one empty wrapper can expose another.
//
// Note: `<p></p>` is intentionally NOT in this list — `wrapLooseLines`
// uses empty `<p>` markers to encode blank-line gaps for round-trip
// fidelity through html-to-docx.
const EMPTY_BLOCK_RE = /<(h[1-6]|code|pre|div|blockquote)\b[^>]*>\s*<\/\1>/gi;
export const dropEmptyBlocks = (html: string): string => {
  let prev: string;
  let cur = html;
  do {
    prev = cur;
    cur = cur.replace(EMPTY_BLOCK_RE, '');
  } while (cur !== prev);
  return cur;
};

// Wrap loose text + inline content in `<p>` blocks so html-to-docx renders
// `<br>` as a soft line break (`<w:br/>`) instead of a paragraph break
// (`<w:p>`). Etherpad's HTML export uses bare `<br>` for every line and
// `<br><br>` for blank lines, so without this DOCX exports get one Word
// paragraph per line and two empty paragraphs for every blank line.
//
// Strategy: capture `<br>` separators of length >= 2 (paragraph separators)
// AND remember how many `<br>`s each separator contains, so blank-line
// gaps survive the round-trip. For N consecutive `<br>`s, emit one
// closing-then-opening paragraph break PLUS (N - 2) empty `<p></p>`
// markers (each empty paragraph = one blank pad line).
const BLOCK_HEAD_RE = /^<(?:p|h[1-6]|ul|ol|table|blockquote|pre|div)[\s>/]/i;
// Anchored so the inner `\s*` can't overlap with surrounding whitespace and
// trigger exponential backtracking. Matches `<br>` followed by at least one
// more `<br>` (with optional whitespace between).
const BR_PARA_RE = /<br\s*\/?>(?:\s*<br\s*\/?>)+/gi;
const TRAILING_BR_RE = /(?:<br\s*\/?>\s*)+$/i;
const BR_COUNT_RE = /<br/gi;
export const wrapLooseLines = (html: string): string => {
  // split() with a capturing group keeps the separators in the result, so
  // parts[i] alternates between content (even i) and br-run separator
  // (odd i).
  const parts = html.split(/(<br\s*\/?>(?:\s*<br\s*\/?>)+)/gi);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      const c = parts[i].replace(TRAILING_BR_RE, '').trim();
      if (!c) continue;
      out.push(BLOCK_HEAD_RE.test(c) ? c : `<p>${c}</p>`);
    } else {
      // Separator of N >= 2 <br>s. The first <br> is the paragraph
      // boundary; the remaining (N - 1) each represent one blank pad
      // line, emitted as an empty <p></p>.
      const n = (parts[i].match(BR_COUNT_RE) || []).length;
      for (let k = 0; k < n - 1; k++) out.push('<p></p>');
    }
  }
  return out.join('');
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
