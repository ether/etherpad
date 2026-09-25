import { useEffect, useRef, useState } from 'react';
import type { JSONPath } from 'jsonc-parser';
import { escapeForInput, unescapeFromInput } from '../stringEscapes';

type Props = {
  value: string;
  path: JSONPath;
  onChange: (next: string) => void;
};

// The input shows the value in its JSON-escaped form (see stringEscapes.ts)
// so newlines survive the single-line <input> and typed `\n` is stored as a
// newline. While focused we keep the user's own text as a draft so partial
// escapes (a lone trailing `\`) aren't reformatted mid-typing; invalid
// drafts are not propagated.
export const StringInput = ({ value, path, onChange }: Props) => {
  const escaped = escapeForInput(value);
  const [draft, setDraft] = useState(escaped);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setDraft(escaped);
      setInvalid(false);
    }
  }, [escaped]);

  return (
    <input
      type="text"
      id={`field-${path.join('.')}`}
      className="settings-widget settings-widget-string"
      data-testid={`field-${path.join('.')}`}
      value={draft}
      spellCheck={false}
      aria-invalid={invalid || undefined}
      onFocus={() => { focused.current = true; }}
      onBlur={() => {
        focused.current = false;
        setDraft(escaped);
        setInvalid(false);
      }}
      onChange={e => {
        const text = e.target.value;
        setDraft(text);
        const decoded = unescapeFromInput(text);
        setInvalid(decoded === null);
        if (decoded !== null) onChange(decoded);
      }}
    />
  );
};
