import type { JSONPath } from 'jsonc-parser';

type Props = { path: JSONPath };

export const NullChip = ({ path }: Props) => (
  <span
    className="settings-widget settings-widget-null"
    data-testid={`field-${path.join('.')}`}
  >null</span>
);
