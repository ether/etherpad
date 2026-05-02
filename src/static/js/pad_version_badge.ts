'use strict';

interface BadgeResponse { outdated: 'severe' | 'vulnerable' | null }

// TODO(i18n): switch to html10n once a `pad.update.badge.*` key set is added there.
// (Strings are deliberately not pulled from /locales/en.json yet — that file is
//  consumed by the admin UI's i18next, not the pad's html10n. Cross-wiring is
//  a separate piece of work.)
const TEXT_BY_LEVEL: Record<'severe' | 'vulnerable', string> = {
  severe: 'Etherpad on this server is severely outdated. Tell your admin.',
  vulnerable: 'Etherpad on this server is running a version with known security issues. Tell your admin.',
};

// padBootstrap.js derives basePath from window.location ('..' relative to the
// pad URL) so deployments hosted under a subpath route requests through the
// same prefix. We replicate that here rather than importing pad.ts (which
// would reintroduce the badge↔pad circular initialisation).
const apiBasePath = (): string => {
  if (typeof window === 'undefined') return '/';
  return new URL('..', window.location.href).pathname;
};

export const renderVersionBadge = async (): Promise<void> => {
  const el = document.getElementById('version-badge');
  if (!el) return;
  try {
    const res = await fetch(`${apiBasePath()}api/version-status`, {credentials: 'same-origin'});
    if (!res.ok) return;
    const data = (await res.json()) as BadgeResponse;
    if (!data.outdated) { el.style.display = 'none'; return; }
    el.textContent = TEXT_BY_LEVEL[data.outdated];
    el.dataset.level = data.outdated;
    el.style.display = '';
  } catch {
    // Quiet failure — never block the pad load.
  }
};

// Auto-render once DOM is ready.
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void renderVersionBadge(); });
  } else {
    void renderVersionBadge();
  }
}
