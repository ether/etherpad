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
    // `noreferrer` matches the existing pattern in pad_utils.ts so the pad
    // URL doesn't leak to the operator-configured external policy site as a
    // Referer header. `noopener` keeps target=_blank from sharing the
    // window.opener handle.
    wrap.append($('<p>').append(
        $('<a>')
            .attr('href', safeHref)
            .attr('target', '_blank')
            .attr('rel', 'noreferrer noopener')
            .text('Learn more')));
  }
  return wrap;
};

export const showPrivacyBannerIfEnabled = (config: BannerConfig | undefined) => {
  if (!config || !config.enabled) return;
  const $ = (window as any).$;
  if (!$ || !$.gritter || typeof $.gritter.add !== 'function') return;

  // Server-side reloadSettings() coerces unknown values to 'dismissible' with a
  // warn, but if a custom build / hot-reload path skips that validation we
  // still must not fall through to "treats unknown as sticky" (which is the
  // less safe interpretation — an operator who fat-fingered "dismisable"
  // probably meant the dismissable mode they wrote).
  const dismissal = config.dismissal === 'sticky' ? 'sticky' : 'dismissible';

  if (dismissal === 'dismissible') {
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
      if (dismissal !== 'dismissible') return;
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
// Gated on navigator.webdriver so the global is invisible in real browsers
// (Playwright/ChromeDriver/Selenium set webdriver=true; humans don't), keeping
// the disabled-by-default feature genuinely zero-side-effect in production.
if (typeof navigator !== 'undefined' && (navigator as any).webdriver) {
  (globalThis as any).__etherpad_privacyBanner__ = {show: showPrivacyBannerIfEnabled};
}
