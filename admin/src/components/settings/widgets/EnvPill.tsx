import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { JSONPath } from 'jsonc-parser';
import type { EnvPlaceholder } from '../envPill';

type Props = {
  placeholder: EnvPlaceholder;
  path: JSONPath;
  onChange: (newDefault: string) => void;
};

const sanitize = (s: string) => s.replace(/[}]/g, '');

export const EnvPill = ({ placeholder, path, onChange }: Props) => {
  const { t } = useTranslation();
  const initial = placeholder.defaultValue ?? '';
  const [draft, setDraft] = useState(initial);
  const focused = useRef(false);

  // Sync local draft from upstream (server canonicalisation, raw-mode edit)
  // only while the input isn't focused so we don't trample mid-typing.
  useEffect(() => {
    if (!focused.current) setDraft(initial);
  }, [initial]);

  const id = `field-${path.join('.')}`;
  const testid = `env-${path.join('.')}`;

  return (
    <span
      className="settings-widget settings-widget-env"
      title={t('admin_settings.env_pill.tooltip', { variable: placeholder.variable })}
    >
      <span className="settings-widget-env-icon" aria-hidden>ⓔ</span>
      <span className="settings-widget-env-name">{placeholder.variable}</span>
      <span className="settings-widget-env-default-label" aria-hidden>
        {t('admin_settings.env_pill.default_label')}
      </span>
      <input
        id={id}
        data-testid={testid}
        className="settings-widget-env-default-input"
        type="text"
        value={draft}
        spellCheck={false}
        aria-label={t('admin_settings.env_pill.input_aria', { variable: placeholder.variable })}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; }}
        onChange={e => {
          const v = sanitize(e.target.value);
          setDraft(v);
          onChange(v);
        }}
      />
    </span>
  );
};
