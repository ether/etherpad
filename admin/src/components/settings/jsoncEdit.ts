// admin/src/components/settings/jsoncEdit.ts
import { applyEdits, modify, type JSONPath } from 'jsonc-parser';

const FORMATTING = {
  formattingOptions: { tabSize: 2, insertSpaces: true, eol: '\n' as const },
};

export const editJsonc = (text: string, path: JSONPath, value: unknown): string => {
  const edits = modify(text, path, value, FORMATTING);
  return edits.length === 0 ? text : applyEdits(text, edits);
};
