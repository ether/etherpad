'use strict';

const mammoth = require('mammoth');
const JSZip = require('jszip');

// mammoth strips paragraph alignment (<w:jc>) when it converts a docx to
// HTML; it has no equivalent style-mapping for justification. To keep
// alignment through the round-trip we walk the docx's document.xml
// directly, pull the `w:val` from each `<w:p>`'s `<w:jc>`, and inject a
// matching `style="text-align:..."` onto the corresponding block element
// in mammoth's output. Match is by document order: the Nth `<p>` /
// `<h1>...<h6>` in mammoth's output corresponds to the Nth `<w:p>` in
// the docx.
const PARA_RE = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
const JC_RE = /<w:jc\s+w:val=["']([^"']+)["']/;
// Word's `w:jc` accepts more values than CSS text-align; map the ones
// we want to surface and skip the rest.
const JC_TO_CSS: Record<string, string> = {
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  both: 'justify',
  justify: 'justify',
  distribute: 'justify',
};

const extractAlignmentMap = async (buffer: Buffer): Promise<Array<string|null>> => {
  const aligns: Array<string|null> = [];
  try {
    const zip = await JSZip.loadAsync(buffer);
    const file = zip.file('word/document.xml');
    if (!file) return aligns;
    const xml: string = await file.async('text');
    let m: RegExpExecArray | null;
    while ((m = PARA_RE.exec(xml)) !== null) {
      const jcMatch = JC_RE.exec(m[1]);
      const css = jcMatch ? JC_TO_CSS[jcMatch[1].toLowerCase()] : null;
      aligns.push(css || null);
    }
  } catch {
    // Best-effort — if the docx structure is anything other than a
    // standard document.xml, fall back to no alignment.
  }
  return aligns;
};

const applyAlignmentToHtml = (html: string, aligns: Array<string|null>): string => {
  if (aligns.length === 0 || !aligns.some((a) => a && a !== 'left')) return html;
  let i = 0;
  return html.replace(/<(p|h[1-6])(\b[^>]*)>/gi, (whole: string, tag: string, attrs: string) => {
    const align = aligns[i++];
    if (!align || align === 'left') return whole;
    if (/\bstyle\s*=/.test(attrs)) {
      return `<${tag}${attrs.replace(
          /\bstyle\s*=\s*(['"])([^'"]*)\1/i,
          (_full: string, q: string, val: string) => `style=${q}${val}; text-align:${align}${q}`)}>`;
    }
    return `<${tag}${attrs} style="text-align:${align}">`;
  });
};

export const docxBufferToHtml = async (buffer: Buffer): Promise<string> => {
  const aligns = await extractAlignmentMap(buffer);
  const result = await mammoth.convertToHtml(
    {buffer},
    {
      // Preserve empty paragraphs so blank pad lines survive a
      // round-trip. mammoth defaults to true and drops them, which
      // collapses blank lines in the middle of a pad's content.
      ignoreEmptyParagraphs: false,
      convertImage: mammoth.images.imgElement(async (image: any) => {
        const buf: Buffer = await image.read();
        const contentType = image.contentType || 'application/octet-stream';
        return {src: `data:${contentType};base64,${buf.toString('base64')}`};
      }),
    },
  );
  let html: string = result.value || '';
  html = applyAlignmentToHtml(html, aligns);
  return html;
};
