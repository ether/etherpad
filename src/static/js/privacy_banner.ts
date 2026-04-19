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

export const showPrivacyBannerIfEnabled = (config: BannerConfig | undefined) => {
  if (!config || !config.enabled) return;
  const banner = document.getElementById('privacy-banner');
  if (banner == null) return;

  if (config.dismissal === 'dismissible') {
    try {
      if (localStorage.getItem(storageKey(location.href)) === '1') return;
    } catch (_e) { /* proceed without persistence */ }
  }

  const titleEl = banner.querySelector('.privacy-banner-title') as HTMLElement | null;
  if (titleEl) titleEl.textContent = config.title || '';

  const bodyEl = banner.querySelector('.privacy-banner-body') as HTMLElement | null;
  if (bodyEl) {
    bodyEl.textContent = '';
    for (const line of (config.body || '').split(/\r?\n/)) {
      const p = document.createElement('p');
      p.textContent = line;
      bodyEl.appendChild(p);
    }
  }

  const linkEl = banner.querySelector('.privacy-banner-link') as HTMLElement | null;
  if (linkEl) {
    linkEl.replaceChildren();
    if (config.learnMoreUrl) {
      const a = document.createElement('a');
      a.href = config.learnMoreUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Learn more';
      linkEl.appendChild(a);
    }
  }

  const closeBtn = banner.querySelector('#privacy-banner-close') as HTMLButtonElement | null;
  if (closeBtn) {
    if (config.dismissal === 'dismissible') {
      closeBtn.hidden = false;
      closeBtn.onclick = () => {
        banner.hidden = true;
        try {
          localStorage.setItem(storageKey(location.href), '1');
        } catch (_e) { /* best-effort */ }
      };
    } else {
      closeBtn.hidden = true;
    }
  }

  banner.hidden = false;
};
