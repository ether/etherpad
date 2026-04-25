import {Trans, useTranslation} from 'react-i18next';
import {useStore} from '../store/store';

export const UpdatePage = () => {
  const {t} = useTranslation();
  const us = useStore((s) => s.updateStatus);

  if (!us) return <div>{t('admin.loading', {defaultValue: 'Loading...'})}</div>;

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
