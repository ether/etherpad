import { Trans, useTranslation } from 'react-i18next';

export type Mode = 'form' | 'raw';

type Props = {
  mode: Mode;
  onChange: (mode: Mode) => void;
};

export const ModeToggle = ({ mode, onChange }: Props) => {
  const { t } = useTranslation();
  return (
  <div className="settings-mode-toggle" role="tablist" aria-label={t('admin_settings.mode.aria_label')}>
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'form'}
      data-testid="mode-toggle-form"
      className={mode === 'form' ? 'active' : ''}
      onClick={() => onChange('form')}
    >
      <Trans i18nKey="admin_settings.mode.form" />
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'raw'}
      data-testid="mode-toggle-raw"
      className={mode === 'raw' ? 'active' : ''}
      onClick={() => onChange('raw')}
    >
      <Trans i18nKey="admin_settings.mode.raw" />
    </button>
  </div>
  );
};
