import {useEffect, useState} from 'react';
import {Trans, useTranslation} from 'react-i18next';
import {useStore} from '../store/store';

type FetchState =
  | {kind: 'loading'}
  | {kind: 'disabled'}
  | {kind: 'unauthorized'}
  | {kind: 'error', status: number}
  | {kind: 'ok'};

export const UpdatePage = () => {
  const {t} = useTranslation();
  const us = useStore((s) => s.updateStatus);
  const setUpdateStatus = useStore((s) => s.setUpdateStatus);
  // Self-fetch so the page renders an explicit state even if UpdateBanner's
  // best-effort fetch never landed (route returns 404 when tier=off, 401/403
  // if requireAdminForStatus is set, or a transient network error).
  const [fetchState, setFetchState] = useState<FetchState>(us ? {kind: 'ok'} : {kind: 'loading'});

  useEffect(() => {
    let cancelled = false;
    fetch('/admin/update/status', {credentials: 'same-origin'})
      .then(async (r) => {
        if (cancelled) return;
        if (r.ok) {
          const data = await r.json();
          setUpdateStatus(data);
          setFetchState({kind: 'ok'});
        } else if (r.status === 404) {
          setFetchState({kind: 'disabled'});
        } else if (r.status === 401 || r.status === 403) {
          setFetchState({kind: 'unauthorized'});
        } else {
          setFetchState({kind: 'error', status: r.status});
        }
      })
      .catch(() => {
        if (!cancelled) setFetchState({kind: 'error', status: 0});
      });
    return () => { cancelled = true; };
  }, [setUpdateStatus]);

  if (fetchState.kind === 'loading') {
    return <div>{t('admin.loading', {defaultValue: 'Loading...'})}</div>;
  }
  if (fetchState.kind === 'disabled') {
    return (
      <div className="update-page">
        <h1><Trans i18nKey="update.page.title"/></h1>
        <p>{t('update.page.disabled', {defaultValue: 'Update checks are disabled (updates.tier = "off").'})}</p>
      </div>
    );
  }
  if (fetchState.kind === 'unauthorized') {
    return (
      <div className="update-page">
        <h1><Trans i18nKey="update.page.title"/></h1>
        <p>{t('update.page.unauthorized', {defaultValue: 'You are not authorised to view update status.'})}</p>
      </div>
    );
  }
  if (fetchState.kind === 'error' || !us) {
    const status = fetchState.kind === 'error' ? fetchState.status : 0;
    return (
      <div className="update-page">
        <h1><Trans i18nKey="update.page.title"/></h1>
        <p>{t('update.page.error', {defaultValue: 'Could not load update status (status {{status}}).', status})}</p>
      </div>
    );
  }

  const upToDate = !us.latest || us.currentVersion === us.latest.version;

  return (
    <div className="update-page">
      <h1><Trans i18nKey="update.page.title"/></h1>
      <dl>
        <dt><Trans i18nKey="update.page.current"/></dt>
        <dd>{us.currentVersion}</dd>
        <dt><Trans i18nKey="update.page.latest"/></dt>
        <dd>{us.latest ? us.latest.version : '—'}</dd>
        <dt><Trans i18nKey="update.page.last_check"/></dt>
        <dd>{us.lastCheckAt ?? '—'}</dd>
        <dt><Trans i18nKey="update.page.install_method"/></dt>
        <dd>{us.installMethod}</dd>
        <dt><Trans i18nKey="update.page.tier"/></dt>
        <dd>{us.tier}</dd>
      </dl>
      {upToDate ? (
        <p><Trans i18nKey="update.page.up_to_date"/></p>
      ) : us.latest ? (
        <>
          <h2><Trans i18nKey="update.page.changelog"/></h2>
          <pre style={{whiteSpace: 'pre-wrap'}}>{us.latest.body}</pre>
          <p><a href={us.latest.htmlUrl} rel="noreferrer noopener" target="_blank">{us.latest.htmlUrl}</a></p>
        </>
      ) : null}
    </div>
  );
};

export default UpdatePage;
