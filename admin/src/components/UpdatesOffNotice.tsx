import {Trans, useTranslation} from 'react-i18next';

// Shown instead of the update banner / update page when updates.tier is
// "off" (issue #8573). The server does not register /admin/update/status in
// that case, so the UI must not request it; instead it explains the setting
// and how to turn update notifications back on.
//
// The URL is assembled at runtime on purpose: behind a reverse proxy the
// server rewrites every literal "/admin" in the admin bundle to
// "<proxy>/admin", which would corrupt an external docs link.
export const UPDATES_DOCS_URL = new URL('admin/updates.html', 'https://docs.etherpad.org/').href;

export const UpdatesOffNotice = ({onDismiss}: {onDismiss?: () => void}) => {
  const {t} = useTranslation();
  return (
    <div className="update-banner update-banner-off" role="status" data-testid="updates-off-notice">
      <div className="update-banner-off-text">
        <strong>{t('update.page.disabled')}</strong>{' '}
        <span>{t('update.off.body')}</span>{' '}
        <span>
          <Trans
            i18nKey="update.off.howto"
            components={{code: <code/>}}
          />
        </span>{' '}
        <a href={UPDATES_DOCS_URL} rel="noreferrer noopener" target="_blank">
          {t('update.off.docs')}
        </a>
      </div>
      {onDismiss && (
        <button type="button" className="update-banner-dismiss" onClick={onDismiss}>
          {t('update.off.dismiss')}
        </button>
      )}
    </div>
  );
};
