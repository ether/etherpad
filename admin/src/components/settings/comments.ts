// admin/src/components/settings/comments.ts
//
// Given the source text and a property's `keyOffset` (jsonc-parser's
// Node.offset for the property node), extract:
//   - `leading`: the contiguous run of `/* */` or `//` comments
//     immediately above the key. At most one blank line is allowed
//     between the comment block and the key.
//   - `trailing`: a single `// ...` or `/* ... */` on the same line
//     as the value, after any trailing comma.

export type AdjacentComments = {
  leading: string;
  trailing: string;
};

const LINE_BREAK = /\r?\n/;

const stripCommentMarkers = (raw: string): string => {
  // raw is a concatenation of comment tokens separated by newlines.
  // Drop /* */ and // markers and trim each line.
  return raw
    .split(LINE_BREAK)
    .map(line => line
      .replace(/^\s*\/\*+/, '')
      .replace(/\*+\/\s*$/, '')
      .replace(/^\s*\*\s?/, '')
      .replace(/^\s*\/\/\s?/, '')
      .trim())
    .filter(line => line.length > 0)
    .join(' ');
};

const findLeading = (text: string, keyOffset: number): string => {
  // Walk backwards from keyOffset to the start of the line containing it.
  const lineStart = text.lastIndexOf('\n', keyOffset - 1) + 1;
  let cursor = lineStart;
  let blankLineSeen = false;
  const collected: string[] = [];

  while (cursor > 0) {
    // Look at the previous line.
    const prevLineEnd = cursor - 1; // the '\n' before our cursor's line
    const prevLineStart = text.lastIndexOf('\n', prevLineEnd - 1) + 1;
    const line = text.slice(prevLineStart, prevLineEnd);
    const trimmed = line.trim();

    if (trimmed === '') {
      if (blankLineSeen) break;
      blankLineSeen = true;
      cursor = prevLineStart;
      continue;
    }

    const isComment =
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.endsWith('*/');

    if (!isComment) break;

    collected.unshift(line);
    cursor = prevLineStart;
  }

  return stripCommentMarkers(collected.join('\n'));
};

const findTrailing = (text: string, valueOffset: number, valueLength: number): string => {
  // Trailing comments only exist on the same line as the value. If there's
  // no newline after the value the file has no line structure (e.g. minified
  // settings.json) and `//` inside any later string literal would otherwise
  // be matched as a comment.
  const lineEnd = text.indexOf('\n', valueOffset + valueLength);
  if (lineEnd === -1) return '';
  const slice = text.slice(valueOffset + valueLength, lineEnd);
  const m = /,?\s*(\/\/.*|\/\*.*?\*\/)\s*$/.exec(slice);
  return m ? stripCommentMarkers(m[1]) : '';
};

export const extractAdjacentComments = (
  text: string,
  keyOffset: number,
  valueOffset: number,
  valueLength: number,
): AdjacentComments => ({
  leading: findLeading(text, keyOffset),
  trailing: findTrailing(text, valueOffset, valueLength),
});
