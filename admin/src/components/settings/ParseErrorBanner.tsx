import { Trans } from 'react-i18next';

type Props = {
  message: string;
  onSwitchToRaw: () => void;
};

export const ParseErrorBanner = ({ message, onSwitchToRaw }: Props) => (
  <div className="settings-parse-error" role="alert" data-testid="parse-error-banner">
    <strong><Trans i18nKey="admin_settings.parse_error.title" /></strong>
    <pre className="settings-parse-error-detail">{message}</pre>
    <button type="button" onClick={onSwitchToRaw} data-testid="parse-error-switch-raw">
      <Trans i18nKey="admin_settings.parse_error.cta" />
    </button>
  </div>
);
