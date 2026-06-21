'use strict';

/**
 * OWASP-style output-escaping helpers.
 *
 * Vendored from the `security` npm package (v1.0.0), which has been
 * unmaintained since 2012. The implementation below is reproduced verbatim
 * (behaviour is byte-identical) so the dependency can be dropped from core.
 *
 * Original work Copyright (c) 2011 Chad Weider, MIT licensed:
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the "Software"),
 *   to deal in the Software without restriction, including without limitation
 *   the rights to use, copy, modify, merge, publish, distribute, sublicense,
 *   and/or sell copies of the Software, and to permit persons to whom the
 *   Software is furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 *   FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 *   DEALINGS IN THE SOFTWARE.
 */

const HTML_ENTITY_MAP: {[c: string]: string} = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
};

// OWASP Guidelines: &, <, >, ", ' plus forward slash.
const HTML_CHARACTERS_EXPRESSION = /[&"'<>/]/gm;
const escapeHTML = (text: string) => text && text.replace(HTML_CHARACTERS_EXPRESSION,
    (c: string) => HTML_ENTITY_MAP[c] || c);

// OWASP Guidelines: escape all non alphanumeric characters in ASCII space.
const HTML_ATTRIBUTE_CHARACTERS_EXPRESSION = /[\x00-\x2F\x3A-\x40\x5B-\x60\x7B-\xFF]/gm;
const escapeHTMLAttribute = (text: string) => text && text.replace(HTML_ATTRIBUTE_CHARACTERS_EXPRESSION,
    (c: string) => HTML_ENTITY_MAP[c] || `&#x${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)};`);

// OWASP Guidelines: escape all non alphanumeric characters in ASCII space.
// Also include line breaks (for literal).
const JAVASCRIPT_CHARACTERS_EXPRESSION = /[\x00-\x2F\x3A-\x40\x5B-\x60\x7B-\xFF\u2028\u2029]/gm;
const encodeJavaScriptIdentifier = (text: string) => text && text.replace(JAVASCRIPT_CHARACTERS_EXPRESSION,
    (c: string) => `\\u${(`0000${c.charCodeAt(0).toString(16)}`).slice(-4)}`);

const encodeJavaScriptString = (text: string) => text && `"${encodeJavaScriptIdentifier(text)}"`;

// This is not great, but it is useful.
const JSON_STRING_LITERAL_EXPRESSION = /"(?:\\.|[^"])*"/gm;
const encodeJavaScriptData = (object: any) => JSON.stringify(object).replace(JSON_STRING_LITERAL_EXPRESSION,
    (string: string) => encodeJavaScriptString(JSON.parse(string)));

// OWASP Guidelines: escape all non alphanumeric characters in ASCII space.
const CSS_CHARACTERS_EXPRESSION = /[\x00-\x2F\x3A-\x40\x5B-\x60\x7B-\xFF]/gm;
const encodeCSSIdentifier = (text: string) => text && text.replace(CSS_CHARACTERS_EXPRESSION,
    (c: string) => `\\${(`000000${c.charCodeAt(0).toString(16)}`).slice(-6)}`);

const encodeCSSString = (text: string) => text && `"${encodeCSSIdentifier(text)}"`;

module.exports = {
  escapeHTML,
  escapeHTMLAttribute,
  encodeJavaScriptIdentifier,
  encodeJavaScriptString,
  encodeJavaScriptData,
  encodeCSSIdentifier,
  encodeCSSString,
};
