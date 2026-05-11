import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {Trans, useTranslation} from 'react-i18next';
import {useStore} from '../store/store';

const fmtRemaining = (ms: number): string => {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
};

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

  const scheduledFor = updateStatus?.execution?.status === 'scheduled'
    ? (updateStatus.execution as {scheduledFor: string}).scheduledFor
    : null;
  const [remainingMs, setRemainingMs] = useState<number>(() =>
    scheduledFor ? Math.max(0, new Date(scheduledFor).getTime() - Date.now()) : 0);
  useEffect(() => {
    if (!scheduledFor) return;
    const target = new Date(scheduledFor).getTime();
    setRemainingMs(Math.max(0, target - Date.now()));
    const id = setInterval(() => setRemainingMs(Math.max(0, target - Date.now())), 1000);
    return () => clearInterval(id);
  }, [scheduledFor]);

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

  // Tier 3: scheduled update — show countdown banner instead of the plain
  // "update available" one.
  if (updateStatus.execution?.status === 'scheduled') {
    const exec = updateStatus.execution as {targetTag: string; scheduledFor: string};
    return (
      <div className="update-banner update-banner-scheduled" role="status">
        <strong>
          <Trans
            i18nKey="update.banner.scheduled"
            values={{tag: exec.targetTag, remaining: fmtRemaining(remainingMs)}}
          />
        </strong>{' '}
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
