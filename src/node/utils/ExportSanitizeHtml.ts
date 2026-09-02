'use strict';

import {Parser} from 'htmlparser2';
import {decodeHTML} from 'entities';

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

// Drop `<br>` immediately following a closing block tag. Etherpad's
// HTML export writes one `<p>...</p>` per pad line (or `<h1>...</h1>`,
// `<code>...</code>` for the styled ones from ep_align/ep_headings2),
// then appends a `<br>` between lines. The `<br>` is redundant — the
// closing block tag already ends the line — and on import the server
// content collector counts BOTH as line breaks, so every blank line
// between two paragraphs gets duplicated.
const REDUNDANT_BR_RE =
  /(<\/(?:p|h[1-6]|div|pre|blockquote|code|ul|ol|li|table|tr|td|th)>)\s*<br\s*\/?>/gi;
export const collapseRedundantBrAfterBlocks = (html: string): string =>
    html.replace(REDUNDANT_BR_RE, '$1');

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

// ---------------------------------------------------------------------------
// Export document sanitizer.
//
// Etherpad hands the exported HTML to a converter that runs on the SERVER:
// html-to-docx and our pdfkit walker in-process, or a LibreOffice subprocess.
// Both dereference subresource URLs — soffice fetches remote images during
// conversion, and html-to-docx's image path fetches http(s) and
// `readFileSync(path.resolve(src))`s everything else — so a URL that survives
// into this document becomes a request issued from the server's network
// position rather than the reader's.
//
// Core itself never emits a subresource URL that isn't relative. Plugins do:
// `getLineHTMLForExport`, `exportHTMLAdditionalContent` and `stylesForExport`
// each splice arbitrary markup or CSS into this document, and what they splice
// in is usually pad content — i.e. attacker-influenced on any install running
// such a plugin. Core chooses the converter, so core owns the egress boundary
// no matter who authored the markup.
//
// The rule below is therefore default-deny on the attribute VALUE rather than
// on the attribute NAME. Anything that canonicalizes to an absolute URL is
// dropped wherever it appears, so a subresource attribute nobody has thought
// of yet is denied on arrival instead of after the next report. The only
// attributes allowed to carry an absolute URL are the navigational ones, which
// no converter dereferences.

// Characters a URL consumer ignores but a naive prefix test does not. WHATWG
// URL trims leading/trailing C0-and-space and strips tab/newline from anywhere
// in the input, so `" http://x"`, `"ht\ttp://x"` and `"http:/\n/x"` all reach
// the network as the same request. Stripping the whole range everywhere is
// deliberately more aggressive than any real parser: this is a detector, and
// it may over-classify but must never under-classify.
const URL_IGNORED_RE = /[\u0000-\u0020\u007f]/g;

// Undo the encodings a downstream HTML or CSS parser will undo before it sees
// a URL. The serializer below still emits the ORIGINAL bytes (decodeEntities
// stays off, so export output round-trips); only the security decision is
// taken on the decoded view. `decodeHTML` is htmlparser2's own decoder, so
// this check cannot drift from the parser that produced the attributes.
const canonicalizeUrl = (raw: string): string => {
  const decoded = decodeHTML(raw).replace(URL_IGNORED_RE, '');
  let pctDecoded: string;
  try {
    pctDecoded = decodeURIComponent(decoded);
  } catch {
    // Malformed percent-escapes: fall back to the undecoded form rather than
    // yielding an empty string, which would read as "safe".
    pctDecoded = decoded;
  }
  // Strip AGAIN after percent-decoding: `%20`, `%09` and `%0a` decode INTO the
  // ignored range, so stripping only beforehand would hand the scheme test a
  // string that still begins with whitespace and reads as "no scheme".
  return pctDecoded.replace(URL_IGNORED_RE, '');
};

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

const hasScheme = (v: string): boolean => SCHEME_RE.test(v) || v.startsWith('//');

// True when resolving this value would take the converter off-box. `data:`
// carries its payload inline and dereferences nothing.
const isRemoteUrl = (raw: string): boolean => {
  const v = canonicalizeUrl(raw);
  if (!v) return false;
  if (/^data:/i.test(v)) return false;
  return hasScheme(v);
};

// A relative path that climbs out of the directory the converter resolves
// against. soffice resolves relative URLs against the temp export directory
// and html-to-docx resolves them against the process cwd, so `../../..`
// reaches unrelated files on the server and embeds them into the output.
const escapesBase = (raw: string): boolean =>
    canonicalizeUrl(raw).split(/[/\\]/).includes('..');

const isFetchable = (raw: string): boolean => isRemoteUrl(raw) || escapesBase(raw);

// Candidate-list attributes (`srcset` and friends) hold several URLs, so a
// remote one can hide behind a leading local one. Test every token; a stray
// URL-shaped token in a non-URL attribute only costs that attribute.
const hasFetchableToken = (value: string): boolean =>
    value.split(/[\s,]+/).some((t) => t !== '' && isFetchable(t));

// Attributes the converters treat as navigation rather than as a subresource:
// they become a hyperlink in the .docx/.odt and are never dereferenced during
// conversion. Pad content is full of these, so they have to survive — but only
// carrying a scheme that is actually navigational.
const NAVIGATIONAL_URL_ATTRS: {[tag: string]: Set<string>} = {
  a: new Set(['href']),
  area: new Set(['href']),
};

const NAV_SCHEME_RE = /^(?:https?|mailto|ftp|ftps|tel|news|nntp|xmpp|irc):/i;

const isSafeNavUrl = (raw: string): boolean => {
  const v = canonicalizeUrl(raw);
  if (!v) return true;
  if (v.startsWith('//')) return true;
  if (!SCHEME_RE.test(v)) return true;
  return NAV_SCHEME_RE.test(v);
};

// CSS fetches too, via `url()` and `@import`. A `style` ATTRIBUTE that wants
// either is dropped whole: nothing core or any known plugin emits needs them,
// and partially rewriting a declaration list invites exactly the
// parser-differential bugs this file exists to avoid. The backslash catches
// CSS escapes (`\75 rl(`) used to spell `url` past a literal match.
// The backslash catches CSS escapes (`\75 rl(`) and `/*` catches comment
// splitting (`u/**/rl(`) — both spell `url` past a literal match.
const CSS_FETCH_RE = /url\s*\(|@import|expression\s*\(|\\|\/\*/i;

// Inside a `<style>` ELEMENT the same constructs are removed surgically
// instead, because that block also carries the author-colour rules and list
// counters that make soffice exports render correctly.
const CSS_IMPORT_RE = /@import[^;]*;?/gi;
const CSS_URL_RE = /url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;
const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const CSS_HEX_ESCAPE_RE = /\\([0-9a-f]{1,6})[ \t\n]?/gi;

// A CSS parser resolves `\75` and `/**/` before it sees a token, so detection
// has to run on the resolved form. This is used for DETECTION ONLY — the text
// that gets emitted is never the decoded copy, because decoding would corrupt
// legitimate escapes inside CSS strings (`content: "\201C"`).
const resolveCssObfuscation = (css: string): string =>
    css.replace(CSS_COMMENT_RE, '')
        .replace(CSS_HEX_ESCAPE_RE, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/\\(.)/g, '$1');

const cssTextFetches = (css: string): boolean => {
  if (/@import/i.test(css)) return true;
  for (const m of css.matchAll(new RegExp(CSS_URL_RE.source, 'gi'))) {
    if (isFetchable(m[2])) return true;
  }
  return false;
};

const sanitizeCssText = (css: string): string => {
  // Surgical pass: remove the plainly-written forms, keeping the rest of the
  // block (author colours, list counters) intact.
  const surgical = css.replace(CSS_IMPORT_RE, '')
      .replace(CSS_URL_RE, (match, _quote, target) =>
        (isFetchable(target) ? 'none' : match));
  // If a fetch still resolves out of an obfuscated form the surgical pass
  // could not see, the block is not something we can safely rewrite
  // declaration-by-declaration — drop its contents. Nothing core or any known
  // plugin emits reaches this, so ordinary exports keep their CSS.
  if (cssTextFetches(resolveCssObfuscation(surgical))) return '';
  return surgical;
};

// Elements that load or execute content, or that change how every other URL in
// the document resolves. `<base href="http://evil/">` is the important one: it
// would turn every relative URL the checks above deliberately allow into a
// remote fetch. None of these appear in an Etherpad export.
const FORBIDDEN_TAGS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base',
]);

const escapeAttr = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const escapeText = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

// Keep only the attributes that cannot make the converter dereference
// anything. Returns the serialized attribute list, already escaped.
const sanitizeAttribs = (tag: string, attribs: {[k: string]: string}): string => {
  const navAttrs = NAVIGATIONAL_URL_ATTRS[tag];
  let out = '';
  for (const [k, v] of Object.entries(attribs)) {
    const key = k.toLowerCase();
    if (key === 'style') {
      if (CSS_FETCH_RE.test(decodeHTML(v))) continue;
    } else if (navAttrs && navAttrs.has(key)) {
      if (!isSafeNavUrl(v)) continue;
    } else if (hasFetchableToken(v)) {
      continue;
    }
    out += ` ${k}="${escapeAttr(v)}"`;
  }
  return out;
};

export const sanitizeExportHtml = (html: string): string => {
  let out = '';
  // Depth of the forbidden subtree we are currently inside. Everything —
  // markup, text and comments — is suppressed while this is non-zero, so
  // `<script>` bodies don't leak out as document text.
  let skipDepth = 0;
  // `<style>` and `<script>` contents arrive as raw text (htmlparser2 does not
  // decode entities there and neither should the serializer re-escape it, or
  // `ol > li` would come back out as `ol &gt; li`).
  let inStyle = false;
  const parser = new Parser({
    onopentag(name, attribs) {
      if (skipDepth > 0 || FORBIDDEN_TAGS.has(name)) {
        skipDepth++;
        return;
      }
      if (name === 'style') inStyle = true;
      if (name === 'img' && isFetchable(attribs.src || '')) {
        // An `<img>` stripped of its src renders as a broken-image box, so
        // substitute the alt text the way this function always has.
        out += escapeText(attribs.alt || '');
        return;
      }
      out += `<${name}${sanitizeAttribs(name, attribs)}>`;
    },
    ontext(text) {
      if (skipDepth > 0) return;
      out += inStyle ? sanitizeCssText(text) : text;
    },
    onclosetag(name) {
      if (skipDepth > 0) {
        skipDepth--;
        return;
      }
      if (name === 'style') inStyle = false;
      if (VOID_TAGS.has(name)) return;
      out += `</${name}>`;
    },
    // Preserve document-level directives (notably `<!doctype html>`) and
    // comments. This runs on the FULL export document for the soffice path,
    // so dropping the doctype would flip LibreOffice into quirks mode.
    // htmlparser2 surfaces the doctype as a processing instruction whose
    // `data` is e.g. `!doctype html`.
    onprocessinginstruction(name, data) {
      if (skipDepth > 0) return;
      out += `<${data}>`;
    },
    oncomment(data) {
      if (skipDepth > 0) return;
      out += `<!--${data}-->`;
    },
  }, {decodeEntities: false, lowerCaseTags: true});
  parser.write(html);
  parser.end();
  return out;
};

/**
 * @deprecated Kept so out-of-tree callers keep working. The sanitizer covers
 * every URL-bearing attribute now, not just `<img src>`; use
 * `sanitizeExportHtml`.
 */
export const stripRemoteImages = sanitizeExportHtml;
