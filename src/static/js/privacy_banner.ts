'use strict';

type BannerConfig = {
  enabled: boolean,
  title: string,
  body: string,
  learnMoreUrl: string | null,
  dismissal: 'dismissible' | 'sticky',
};

const storageKey = (url: string): string => {
  try {
    return `etherpad.privacyBanner.dismissed:${new URL(url).origin}`;
  } catch (_e) {
    return 'etherpad.privacyBanner.dismissed';
  }
};

// Only http(s) and mailto: are allowed for the "Learn more" link, so a
// misconfigured privacyBanner.learnMoreUrl cannot smuggle a javascript:,
// data:, or vbscript: URL into the anchor and execute script on click.
const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const safeUrl = (href: string | null | undefined): string | null => {
  if (typeof href !== 'string' || href === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(href, location.href);
  } catch (_e) {
    return null;
  }
  if (!SAFE_URL_SCHEMES.has(parsed.protocol)) return null;
  return parsed.href;
};

// Build a jQuery DOM fragment for the gritter `text` parameter. Each line of
// the body becomes its own <p> (mirrors what the original config supports), and
// an optional "Learn more" anchor is appended only after the URL has passed
// through safeUrl().
const buildBody = (config: BannerConfig): JQuery => {
  const $ = (window as any).$;
  const wrap = $('<div>');
  for (const line of (config.body || '').split(/\r?\n/)) {
    wrap.append($('<p>').text(line));
  }
  const safeHref = safeUrl(config.learnMoreUrl);
  if (safeHref != null) {
    wrap.append($('<p>').append(
        $('<a>')
            .attr('href', safeHref)
            .attr('target', '_blank')
            .attr('rel', 'noopener')
            .text('Learn more')));
  }
  return wrap;
};

export const showPrivacyBannerIfEnabled = (config: BannerConfig | undefined) => {
  if (!config || !config.enabled) return;
  const $ = (window as any).$;
  if (!$ || !$.gritter || typeof $.gritter.add !== 'function') return;

  if (config.dismissal === 'dismissible') {
    try {
      if (localStorage.getItem(storageKey(location.href)) === '1') return;
    } catch (_e) { /* proceed without persistence */ }
  }

  // Reused class lets the Playwright spec target this specific gritter without
  // affecting its appearance — the gritter looks like every other gritter on
  // the page.
  $.gritter.add({
    title: config.title || '',
    text: buildBody(config),
    sticky: true,
    position: 'bottom',
    class_name: 'privacy-notice',
    before_close: () => {
      if (config.dismissal !== 'dismissible') return;
      try {
        localStorage.setItem(storageKey(location.href), '1');
      } catch (_e) { /* best-effort */ }
    },
  });
};

// End-to-end test hook. The privacy_banner module is bundled into pad.js so
// the Playwright spec at src/tests/frontend-new/specs/privacy_banner.spec.ts
// has no other way to reach into the real showPrivacyBannerIfEnabled — without
// this it can only toy with the DOM and never proves the config-to-DOM wiring.
// Namespaced under __etherpad_privacyBanner__ so it can't collide with site
// code.
(globalThis as any).__etherpad_privacyBanner__ = {show: showPrivacyBannerIfEnabled};
