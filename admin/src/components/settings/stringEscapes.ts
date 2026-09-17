// admin/src/components/settings/stringEscapes.ts
//
// Form-view string widgets are single-line <input>s. Browsers strip line
// breaks from an <input>'s value, and settings.json documents values such
// as `"defaultPadText": "Line 1\nLine 2"` using JSON escape sequences. So
// the widgets show and accept string values in that same escaped form:
// a newline is displayed as `\n`, and typing `\n` stores a newline
// (issue #8211). Double quotes and slashes are left as-is for readability;
// their escaped forms (`\"`, `\/`) are still accepted on input.

const SHORT_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
};

const SHORT_UNESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/** Turn a decoded string value into the escaped text shown in an input. */
export const escapeForInput = (value: string): string =>
  // eslint-disable-next-line no-control-regex
  value.replace(/[\\\u0000-\u001f\u2028\u2029]/g, (c) =>
    SHORT_ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * Decode the escaped text typed into an input back into the string value.
 * Returns null when the text contains an invalid or incomplete escape
 * sequence (e.g. a trailing `\` while the user is still typing).
 */
export const unescapeFromInput = (text: string): string | null => {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) return null;
    if (next === 'u') {
      const hex = text.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    const decoded = SHORT_UNESCAPES[next];
    if (decoded === undefined) return null;
    out += decoded;
    i += 1;
  }
  return out;
};
