import { useEffect, useRef, useState } from 'react';
import type { JSONPath } from 'jsonc-parser';

type Props = {
  value: number;
  path: JSONPath;
  onChange: (next: number) => void;
};

export const NumberInput = ({ value, path, onChange }: Props) => {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const focusedRef = useRef(false);

  // Sync draft when the prop value changes (e.g. after a server round-trip
  // canonicalises the number) — but only when the input is not focused so we
  // don't stomp on the user while they are typing.
  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(String(value));
      setInvalid(false);
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      id={`field-${path.join('.')}`}
      className={'settings-widget settings-widget-number' + (invalid ? ' invalid' : '')}
      data-testid={`field-${path.join('.')}`}
      value={draft}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => { focusedRef.current = false; }}
      onChange={e => {
        const next = e.target.value;
        setDraft(next);
        const parsed = Number(next);
        if (next.trim() !== '' && Number.isFinite(parsed)) {
          setInvalid(false);
          onChange(parsed);
        } else {
          setInvalid(true);
        }
      }}
    />
  );
};
