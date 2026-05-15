import type { JSONPath } from 'jsonc-parser';

type Props = {
  value: string;
  path: JSONPath;
  onChange: (next: string) => void;
};

export const StringInput = ({ value, path, onChange }: Props) => (
  <input
    type="text"
    id={`field-${path.join('.')}`}
    className="settings-widget settings-widget-string"
    data-testid={`field-${path.join('.')}`}
    value={value}
    spellCheck={false}
    onChange={e => onChange(e.target.value)}
  />
);
