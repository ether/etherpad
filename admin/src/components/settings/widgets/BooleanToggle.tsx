import * as Switch from '@radix-ui/react-switch';
import type { JSONPath } from 'jsonc-parser';

type Props = {
  value: boolean;
  path: JSONPath;
  onChange: (next: boolean) => void;
};

export const BooleanToggle = ({ value, path, onChange }: Props) => (
  <Switch.Root
    checked={value}
    onCheckedChange={onChange}
    id={`field-${path.join('.')}`}
    className="settings-widget settings-widget-boolean"
    data-testid={`field-${path.join('.')}`}
  >
    <Switch.Thumb className="settings-widget-boolean-thumb" />
  </Switch.Root>
);
