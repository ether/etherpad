import { Trans, useTranslation } from 'react-i18next';

export type Mode = 'form' | 'raw' | 'effective';

type Props = {
  mode: Mode;
  onChange: (mode: Mode) => void;
  // When false, the Effective tab is hidden. We hide it for installs that
  // aren't using env-var substitution at all — there's no useful difference
  // between the raw file and the effective in-memory config for them.
  showEffective?: boolean;
};

export const ModeToggle = ({ mode, onChange, showEffective = false }: Props) => {
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
    {showEffective && (
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'effective'}
        data-testid="mode-toggle-effective"
        className={mode === 'effective' ? 'active' : ''}
        onClick={() => onChange('effective')}
        title={t('admin_settings.mode.effective_tooltip')}
      >
        <Trans i18nKey="admin_settings.mode.effective" />
      </button>
    )}
  </div>
  );
};
