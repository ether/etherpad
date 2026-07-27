'use strict';

interface OutdatedResponse {
  outdated: 'minor' | null;
  isFirstAuthor: boolean;
}

const apiBasePath = (): string => {
  if (typeof window === 'undefined') return '/';
  return new URL('..', window.location.href).pathname;
};

const currentPadId = (): string | null => {
  const id = (window as any).clientVars?.padId;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

export const maybeShowOutdatedNotice = async (): Promise<void> => {
  const padId = currentPadId();
  if (!padId) return;
  const $ = (window as any).$;
  if (!$ || !$.gritter || typeof $.gritter.add !== 'function') return;

  try {
    const url = `${apiBasePath()}api/version-status?padId=${encodeURIComponent(padId)}`;
    const res = await fetch(url, {credentials: 'same-origin'});
    if (!res.ok) return;
    const data = (await res.json()) as OutdatedResponse;
    if (data.outdated !== 'minor' || !data.isFirstAuthor) return;

    // TODO(i18n): switch to html10n once `pad.outdatedNotice.*` keys land.
    $.gritter.add({
      title: 'Etherpad update available',
      text: 'A newer version of Etherpad has been released. Consider updating this server.',
      sticky: false,
      position: 'bottom',
      class_name: 'outdated-notice',
      time: 8000,
    });
  } catch {
    /* never block pad load */
  }
};
