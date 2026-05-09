// Copyright 2026 Etherpad contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: Apache-2.0

// PadModeController — issue #7659.
//
// Lets the user enter/leave the timeslider in-place on the pad URL. The
// existing /p/:pad/timeslider stack is reused unmodified inside an iframe;
// this controller handles the outer DOM, browser history, and a tiny bridge
// between the inner slider's hash/state and the outer URL/banner.

'use strict';

type Mode = 'live' | 'history';

const HASH_PREFIX = '#rev/';

// Parse the outer-page hash. Accepts both the new "#rev/N" form and the
// legacy "#NN" shortlink form so old timeslider bookmarks keep working
// after the server-side redirect drops the path component.
const parseRevFromHash = (hash: string): number | null => {
  if (!hash || hash.length < 2) return null;
  if (hash.startsWith(HASH_PREFIX)) {
    const rest = hash.slice(HASH_PREFIX.length);
    if (rest === 'latest') return -1;
    const n = Number(rest);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }
  // Legacy "#NN" form — preserved across the 302 redirect from the old
  // /p/:pad/timeslider#NN URL.
  if (/^#\d+$/.test(hash)) return Number(hash.slice(1));
  return null;
};

const buildOuterHash = (rev: number | null): string =>
  rev == null || rev < 0 ? `${HASH_PREFIX}latest` : `${HASH_PREFIX}${rev}`;

class PadModeController {
  private mode: Mode = 'live';
  private iframe: HTMLIFrameElement | null = null;
  private banner: HTMLElement;
  private mount: HTMLElement;
  private revLabel: HTMLElement;
  private dateLabel: HTMLElement;
  private padId: string;
  private innerHashChangeHandler: (() => void) | null = null;
  private revObserver: MutationObserver | null = null;
  private syncingHash = false;

  constructor() {
    this.banner = document.getElementById('history-banner')!;
    this.mount = document.getElementById('history-frame-mount')!;
    this.revLabel = document.getElementById('history-banner-rev')!;
    this.dateLabel = document.getElementById('history-banner-date')!;
    // /p/:pad → ['', 'p', ':pad'].
    const parts = window.location.pathname.split('/').filter(Boolean);
    this.padId = decodeURIComponent(parts[parts.length - 1] || '');

    document.getElementById('history-banner-return')!
        .addEventListener('click', () => { this.exitHistory(); });

    window.addEventListener('hashchange', () => { this.onOuterHashChange(); });
    window.addEventListener('popstate', () => { this.onOuterHashChange(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.mode === 'history') this.exitHistory();
    });
  }

  // Called once after pad.init() so an initial #rev/N (or legacy #NN) on
  // page load enters history mode without an extra round-trip.
  bootstrapFromHash(): void {
    const rev = parseRevFromHash(window.location.hash);
    if (rev != null) this.enterHistory(rev);
  }

  getMode(): Mode { return this.mode; }

  enterHistory(rev: number | null = null): void {
    if (this.mode === 'history') {
      // Already in history — just retarget the inner slider.
      if (rev != null && this.iframe) this.setInnerRevision(rev);
      return;
    }
    this.mode = 'history';
    document.body.classList.add('history-mode');
    this.banner.removeAttribute('hidden');
    this.mount.removeAttribute('hidden');

    // Push the new state. If the user lands here from the toolbar button we
    // pushState so browser back exits history; if they arrived via a direct
    // hash (bootstrap path) the current entry already represents history.
    const desiredHash = buildOuterHash(rev);
    if (window.location.hash !== desiredHash) {
      this.syncingHash = true;
      try {
        history.pushState(null, '', `${window.location.pathname}${desiredHash}`);
      } finally {
        this.syncingHash = false;
      }
    }
    this.mountIframe(rev);
  }

  exitHistory(): void {
    if (this.mode === 'live') return;
    this.mode = 'live';
    this.unmountIframe();
    this.banner.setAttribute('hidden', '');
    this.mount.setAttribute('hidden', '');
    document.body.classList.remove('history-mode');
    if (window.location.hash) {
      this.syncingHash = true;
      try {
        history.replaceState(null, '', window.location.pathname);
      } finally {
        this.syncingHash = false;
      }
    }
    this.revLabel.textContent = '';
    this.dateLabel.textContent = '';
  }

  private mountIframe(rev: number | null): void {
    const innerHash = rev == null || rev < 0 ? '' : `#${rev}`;
    const src =
        `${encodeURIComponent(this.padId)}/timeslider?embed=1${innerHash}`;
    const iframe = document.createElement('iframe');
    iframe.id = 'history-frame';
    iframe.title = 'Pad history viewer';
    iframe.src = src;
    iframe.addEventListener('load', () => { this.attachInnerBridges(iframe); });
    this.mount.appendChild(iframe);
    this.iframe = iframe;
  }

  private unmountIframe(): void {
    if (this.revObserver) {
      this.revObserver.disconnect();
      this.revObserver = null;
    }
    if (this.iframe) {
      try {
        if (this.innerHashChangeHandler && this.iframe.contentWindow) {
          this.iframe.contentWindow.removeEventListener(
              'hashchange', this.innerHashChangeHandler);
        }
      } catch (_e) { /* cross-origin shouldn't happen, but be defensive */ }
      this.iframe.remove();
      this.iframe = null;
    }
    this.innerHashChangeHandler = null;
  }

  private attachInnerBridges(iframe: HTMLIFrameElement): void {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) return;

    // When the inner slider moves it sets its own location.hash (#NN). Mirror
    // the change to the outer URL so the user's address bar stays canonical.
    this.innerHashChangeHandler = () => {
      if (this.syncingHash) return;
      const innerHash = win.location.hash;
      const rev = innerHash.startsWith('#') ? Number(innerHash.slice(1)) : NaN;
      if (Number.isFinite(rev)) this.setOuterRev(rev);
    };
    win.addEventListener('hashchange', this.innerHashChangeHandler);

    // The inner template populates #revision_label / #revision_date from JS
    // each time the slider moves. Mirror them into the outer banner via a
    // MutationObserver so the user always sees the current revision.
    const innerLabel = doc.getElementById('revision_label');
    const innerDate = doc.getElementById('revision_date');
    if (innerLabel || innerDate) {
      const sync = () => {
        if (innerLabel) this.revLabel.textContent = innerLabel.textContent || '';
        if (innerDate) this.dateLabel.textContent = innerDate.textContent || '';
      };
      sync();
      this.revObserver = new MutationObserver(sync);
      if (innerLabel) {
        this.revObserver.observe(innerLabel, {childList: true, subtree: true, characterData: true});
      }
      if (innerDate) {
        this.revObserver.observe(innerDate, {childList: true, subtree: true, characterData: true});
      }
    }
  }

  private setInnerRevision(rev: number): void {
    if (!this.iframe || !this.iframe.contentWindow) return;
    try {
      this.iframe.contentWindow.location.hash = `#${rev}`;
    } catch (_e) { /* same-origin guaranteed; ignore the unlikely failure */ }
  }

  private setOuterRev(rev: number): void {
    const desired = buildOuterHash(rev);
    if (window.location.hash === desired) return;
    this.syncingHash = true;
    try {
      history.replaceState(null, '', `${window.location.pathname}${desired}`);
    } finally {
      this.syncingHash = false;
    }
  }

  private onOuterHashChange(): void {
    if (this.syncingHash) return;
    const rev = parseRevFromHash(window.location.hash);
    if (rev == null) {
      if (this.mode === 'history') this.exitHistory();
      return;
    }
    if (this.mode === 'live') {
      this.enterHistory(rev);
    } else {
      this.setInnerRevision(rev < 0 ? 0 : rev);
    }
  }
}

let singleton: PadModeController | null = null;

export const padMode = {
  init(): void {
    if (singleton) return;
    singleton = new PadModeController();
    singleton.bootstrapFromHash();
  },
  enterHistory(rev: number | null = null): void {
    singleton?.enterHistory(rev);
  },
  exitHistory(): void {
    singleton?.exitHistory();
  },
  getMode(): 'live' | 'history' {
    return singleton ? singleton.getMode() : 'live';
  },
};

export default padMode;
