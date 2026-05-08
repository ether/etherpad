'use strict';

import {Parser} from 'htmlparser2';

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
