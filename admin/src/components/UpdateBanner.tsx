import {useEffect} from 'react';
import {Link} from 'react-router-dom';
import {Trans, useTranslation} from 'react-i18next';
import {useStore} from '../store/store';

export const UpdateBanner = () => {
  const {t} = useTranslation();
  const updateStatus = useStore((s) => s.updateStatus);
  const setUpdateStatus = useStore((s) => s.setUpdateStatus);

  useEffect(() => {
    let cancelled = false;
    fetch('/admin/update/status', {credentials: 'same-origin'})
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data && !cancelled) setUpdateStatus(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [setUpdateStatus]);

  if (!updateStatus) return null;

  // Terminal rollback-failed wins over the regular "update available" banner —
  // an admin who left the system in this state needs to fix it before any
  // other admin work matters.
  if (updateStatus.execution?.status === 'rollback-failed') {
    return (
      <div className="update-banner update-banner-terminal" role="alert">
        <strong><Trans i18nKey="update.banner.terminal.rollback-failed"/></strong>{' '}
        <Link to="/update">{t('update.banner.cta')}</Link>
      </div>
    );
  }

  if (!updateStatus.latest) return null;
  if (updateStatus.currentVersion === updateStatus.latest.version) return null;

  return (
    <div className="update-banner" role="status">
      <strong><Trans i18nKey="update.banner.title"/></strong>{' '}
      <span>
        <Trans
          i18nKey="update.banner.body"
          values={{latest: updateStatus.latest.version, current: updateStatus.currentVersion}}
        />
      </span>{' '}
      <Link to="/update">{t('update.banner.cta')}</Link>
    </div>
  );
};
