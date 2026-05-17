import {useEffect, useState} from 'react';
import {Trans, useTranslation} from 'react-i18next';
import {useStore} from '../store/store';

type FetchState =
  | {kind: 'loading'}
  | {kind: 'disabled'}
  | {kind: 'unauthorized'}
  | {kind: 'error', status: number}
  | {kind: 'ok'};

const IN_FLIGHT_STATUSES = ['preflight', 'draining', 'executing', 'rolling-back'];

const fmtRemaining = (ms: number): string => {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
};

export const UpdatePage = () => {
  const {t} = useTranslation();
  const us = useStore((s) => s.updateStatus);
  const setUpdateStatus = useStore((s) => s.setUpdateStatus);
  const log = useStore((s) => s.updateLog);
  const setLog = useStore((s) => s.setUpdateLog);
  // Self-fetch so the page renders an explicit state even if UpdateBanner's
  // best-effort fetch never landed (route returns 404 when tier=off, 401/403
  // if requireAdminForStatus is set, or a transient network error).
  const [fetchState, setFetchState] = useState<FetchState>(us ? {kind: 'ok'} : {kind: 'loading'});
  const [actionInFlight, setActionInFlight] = useState(false);

  const refreshStatus = async () => {
    try {
      const r = await fetch('/admin/update/status', {credentials: 'same-origin'});
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
    } catch {
      setFetchState({kind: 'error', status: 0});
    }
  };

  useEffect(() => {
    let cancelled = false;
    void refreshStatus().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll log + status while the executor is in flight, then stop.
  const status = us?.execution?.status ?? 'idle';
  const inFlight = IN_FLIGHT_STATUSES.includes(status);
  useEffect(() => {
    if (!inFlight) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const lr = await fetch('/admin/update/log', {credentials: 'same-origin'});
        if (lr.ok) setLog(await lr.text());
      } catch {/* noop */}
      await refreshStatus();
      if (!cancelled) setTimeout(tick, 1000);
    };
    void tick();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlight]);

  const post = async (path: string) => {
    setActionInFlight(true);
    try {
      await fetch(path, {method: 'POST', credentials: 'same-origin'});
      await refreshStatus();
    } finally {
      setActionInFlight(false);
    }
  };

  // Tier 3 countdown — derive scheduledFor outside the conditional returns so
  // the hook order is stable on every render.
  const scheduledFor = us?.execution?.status === 'scheduled'
    ? (us.execution as {scheduledFor: string}).scheduledFor
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
    const stat = fetchState.kind === 'error' ? fetchState.status : 0;
    return (
      <div className="update-page">
        <h1><Trans i18nKey="update.page.title"/></h1>
        <p>{t('update.page.error', {defaultValue: 'Could not load update status (status {{status}}).', status: stat})}</p>
      </div>
    );
  }

  const upToDate = !us.latest || us.currentVersion === us.latest.version;
  const showApply = !!us.policy?.canManual
    && (status === 'idle' || status === 'verified' || status === 'scheduled')
    && !us.lockHeld
    && !upToDate;
  const showCancel = status === 'preflight' || status === 'draining' || status === 'scheduled';
  const showAcknowledge = status === 'preflight-failed' || status === 'rolled-back' || status === 'rollback-failed';

  // Optional-chain the execution lookup: some integration-test stubs of
  // /admin/update/status omit Tier 2/3 fields entirely (see
  // update-banner.spec.ts), and accessing `.status` on an undefined
  // execution would crash the whole page before the h1 renders.
  const scheduled = us.execution?.status === 'scheduled'
    ? us.execution as {targetTag: string; scheduledFor: string}
    : null;

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
        <dt><Trans i18nKey="update.page.execution"/></dt>
        <dd>{t(`update.execution.${status}`, {defaultValue: status})}</dd>
      </dl>

      {us.lastResult && (
        <p className={`last-result last-result-${us.lastResult.outcome}`}>
          <Trans
            i18nKey={`update.page.last_result.${us.lastResult.outcome}`}
            values={{tag: us.lastResult.targetTag, reason: us.lastResult.reason ?? ''}}
          />
        </p>
      )}

      {us.policy && !us.policy.canManual && !upToDate && (
        <p className="policy-deny">
          <Trans
            i18nKey={`update.page.policy.${us.policy.reason}`}
            defaults={us.policy.reason}
          />
        </p>
      )}

      {scheduled && (
        <section className="update-scheduled" aria-live="polite">
          <h2><Trans i18nKey="update.page.scheduled.title"/></h2>
          <p>
            <Trans
              i18nKey="update.page.scheduled.countdown"
              values={{tag: scheduled.targetTag, remaining: fmtRemaining(remainingMs)}}
            />
          </p>
          {/* Tier 4: only surface the deferral subtitle when `scheduledFor`
              was actually snapped forward to the next window opening. The
              backend keeps `scheduledFor = now + grace` whenever that lands
              inside the window, so we can't use a fixed time-distance
              heuristic (a normal 15-min grace would falsely match). Instead,
              compare against `nextWindowOpensAt` with a small tolerance — the
              two are computed seconds apart at request time, so an exact-ish
              match is the only safe signal that the schedule was deferred. */}
          {us.tier === 'autonomous' && us.nextWindowOpensAt
              && Math.abs(new Date(scheduled.scheduledFor).getTime()
                          - new Date(us.nextWindowOpensAt).getTime()) < 60 * 1000 && (
            <p className="update-scheduled-deferred">
              <Trans
                i18nKey="update.page.scheduled.deferred_until"
                values={{at: us.nextWindowOpensAt}}
              />
            </p>
          )}
        </section>
      )}

      {us.tier === 'autonomous' && (
        <section className="update-maintenance-window">
          <h2><Trans i18nKey="update.window.title"/></h2>
          {us.maintenanceWindow ? (
            <>
              <p>
                <Trans
                  i18nKey="update.window.summary"
                  values={{
                    start: us.maintenanceWindow.start,
                    end: us.maintenanceWindow.end,
                    tz: us.maintenanceWindow.tz,
                  }}
                />
              </p>
              {us.nextWindowOpensAt && (
                <p>
                  <Trans
                    i18nKey="update.window.next_opens_at"
                    values={{at: us.nextWindowOpensAt}}
                  />
                </p>
              )}
            </>
          ) : (
            <p><Trans i18nKey="update.window.unset"/></p>
          )}
        </section>
      )}

      <div className="update-actions">
        {showApply && (
          <button onClick={() => post('/admin/update/apply')} disabled={actionInFlight}>
            {status === 'scheduled'
              ? t('update.page.scheduled.apply_now')
              : t('update.page.apply')}
          </button>
        )}
        {showCancel && (
          <button onClick={() => post('/admin/update/cancel')} disabled={actionInFlight}>
            {t('update.page.cancel')}
          </button>
        )}
        {showAcknowledge && (
          <button onClick={() => post('/admin/update/acknowledge')} disabled={actionInFlight}>
            {t('update.page.acknowledge')}
          </button>
        )}
      </div>

      {inFlight && (
        <section className="update-log">
          <h2><Trans i18nKey="update.page.log"/></h2>
          <pre style={{whiteSpace: 'pre-wrap', maxHeight: '320px', overflow: 'auto'}}>{log}</pre>
        </section>
      )}

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
