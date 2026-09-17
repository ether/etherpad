import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { JSONPath } from 'jsonc-parser';
import type { EnvPlaceholder } from '../envPill';
import { escapeForInput, unescapeFromInput } from '../stringEscapes';

const REDACTED = '[REDACTED]';

type Props = {
  placeholder: EnvPlaceholder;
  path: JSONPath;
  onChange: (newDefault: string) => void;
  resolvedValue?: unknown;
};

const sanitize = (s: string) => s.replace(/[}]/g, '');

// Decode an escaped default. A `}` (e.g. from `\u007d`) would terminate the
// `${VAR:default}` placeholder, so treat it as invalid rather than silently
// dropping it.
const decodeDefault = (s: string): string | null => {
  const decoded = unescapeFromInput(s);
  return decoded === null || decoded.includes('}') ? null : decoded;
};

const formatDisplay = (v: unknown): string => {
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  return String(v);
};

export const EnvPill = ({ placeholder, path, onChange, resolvedValue }: Props) => {
  const { t } = useTranslation();
  // defaultValue is sliced from the raw JSON text, so it is still escaped.
  // Normalise it through decode/escape so it matches what StringInput shows
  // (e.g. `https:\/\/` displays as `https://`) — see stringEscapes.ts.
  const rawDefault = placeholder.defaultValue ?? '';
  const decodedDefault = decodeDefault(rawDefault);
  const initial = decodedDefault === null ? rawDefault : escapeForInput(decodedDefault);
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setDraft(initial);
      setInvalid(false);
    }
  }, [initial]);

  const id = `field-${path.join('.')}`;
  const testid = `env-${path.join('.')}`;

  // Three runtime states:
  //   undefined → server didn't send resolved (old server, or path absent)
  //   '[REDACTED]' → secret hidden
  //   anything else → live runtime value
  const hasResolved = resolvedValue !== undefined;
  const isRedacted = resolvedValue === REDACTED;

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
        aria-invalid={invalid || undefined}
        onFocus={() => { focused.current = true; }}
        onBlur={() => {
          focused.current = false;
          // Drop a rejected draft so the field never shows a value that
          // was not applied to the settings text.
          setDraft(initial);
          setInvalid(false);
        }}
        onChange={e => {
          const v = sanitize(e.target.value);
          setDraft(v);
          // The draft is in escaped form; hand the decoded value to the
          // JSON writer so typed `\n` is stored as `\n`, not `\\n` (#8211).
          // Incomplete escapes (a trailing `\`) are not propagated.
          const decoded = decodeDefault(v);
          setInvalid(decoded === null);
          if (decoded !== null) onChange(decoded);
        }}
      />
      {hasResolved && !isRedacted && (
        <span
          className="settings-widget-env-runtime"
          data-testid={`env-runtime-${path.join('.')}`}
          title={t('admin_settings.env_pill.runtime_tooltip', { variable: placeholder.variable })}
        >
          <span className="settings-widget-env-runtime-arrow" aria-hidden>→</span>
          <span className="settings-widget-env-runtime-label" aria-hidden>
            {t('admin_settings.env_pill.runtime_label')}
          </span>
          <span className="settings-widget-env-runtime-value">
            {formatDisplay(resolvedValue)}
          </span>
        </span>
      )}
      {isRedacted && (
        <span
          className="settings-widget-env-runtime settings-widget-env-runtime-redacted"
          data-testid={`env-runtime-redacted-${path.join('.')}`}
          title={t('admin_settings.env_pill.redacted_tooltip', { variable: placeholder.variable })}
          aria-label={t('admin_settings.env_pill.redacted_tooltip', { variable: placeholder.variable })}
        >
          <span aria-hidden>→ ••••••</span>
        </span>
      )}
    </span>
  );
};
