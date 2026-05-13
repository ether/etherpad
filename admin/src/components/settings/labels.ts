// Pretty-label derivation. The first sentence of a key's documentation
// comment is its label; the rest stays in the help-text slot. When no
// comment exists, fall back to a humanized key name (camelCase → "Camel
// case").

const SENTENCE_END = /[.!?](\s|$)/;

const humanize = (key: string): string => {
  if (!key) return key;
  // Split camelCase / PascalCase / snake_case / kebab-case
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .trim()
    .split(/\s+/);
  if (words.length === 0) return key;
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) +
    (words.length > 1 ? ' ' + words.slice(1).join(' ') : '');
};

const splitFirstSentence = (text: string): { head: string; rest: string } => {
  const trimmed = text.trim();
  const m = SENTENCE_END.exec(trimmed);
  if (!m) return { head: trimmed, rest: '' };
  const cut = m.index + 1; // include the punctuation
  return {
    head: trimmed.slice(0, cut).trim(),
    rest: trimmed.slice(cut).trim(),
  };
};

export const labelAndHelp = (
  comment: string | null | undefined,
  key: string,
): { label: string; help: string } => {
  if (!comment || !comment.trim()) {
    return { label: humanize(key), help: '' };
  }
  const { head, rest } = splitFirstSentence(comment);
  return {
    label: head || humanize(key),
    help: rest,
  };
};
