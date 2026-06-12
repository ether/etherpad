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

// Map of an outer export anchor to its live-mode `href`, captured on entry to
// history mode so we can restore on exit.
type HrefSnapshot = Map<HTMLAnchorElement, string>;

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
  // Watches the embedded slider's #ui-slider-bar so saved revisions added live
  // (NEW_SAVEDREV from a collaborator while we're in history mode) get mirrored
  // onto the outer slider — clientVars only carries the entry-time snapshot.
  private savedRevObserver: MutationObserver | null = null;
  private syncingHash = false;

  // History-mode bridges — populated on enter, torn down on exit.
  private exportSnapshot: HrefSnapshot | null = null;
  private usersSnapshot: string | null = null;
  private chatHeaderSnapshot: {parent: HTMLElement; sibling: Node | null} | null = null;
  private chatHeaderEl: HTMLElement | null = null;
  // Every listener we attach to an outer Settings / history control is
  // tracked here so teardownBridges() can remove them all in one pass.
  private outerControlListeners: Array<{el: HTMLElement; type: string; fn: EventListener}> = [];

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
    this.localizeControls();
    const rev = parseRevFromHash(window.location.hash);
    if (rev != null) this.enterHistory(rev);
  }

  // The icon buttons have no text content; we set their `title` (hover
  // tooltip) and `aria-label` (screen reader name) from html10n once it
  // has loaded. Re-runs on the html10n `localized` event so language
  // switches at runtime stay in sync.
  private localizeControls(): void {
    const html10n: any = (window as any).html10n;
    if (!html10n || typeof html10n.get !== 'function') return;
    const apply = () => {
      const setLabel = (id: string, key: string) => {
        const el = document.getElementById(id);
        if (!el) return;
        const txt = html10n.get(key);
        if (!txt) return;
        el.setAttribute('title', txt);
        el.setAttribute('aria-label', txt);
      };
      setLabel('history-playpause', 'timeslider.playPause');
      setLabel('history-leftstep', 'timeslider.backRevision');
      setLabel('history-rightstep', 'timeslider.forwardRevision');
      setLabel('history-slider-input', 'pad.historyMode.sliderLabel');
      const ctrl = document.getElementById('history-controls');
      const ctrlLabel = html10n.get('pad.historyMode.controlsLabel');
      if (ctrl && ctrlLabel) ctrl.setAttribute('aria-label', ctrlLabel);
      // Follow toggle is rendered as an eye icon — title (hover tooltip)
      // and aria-label are populated from html10n and updated whenever
      // state flips so screen readers + tooltip both narrate the action
      // the click would take.
      const followInput = document.getElementById('history-options-followContents') as HTMLInputElement | null;
      const followLabel = document.querySelector<HTMLLabelElement>('.history-follow-toggle');
      const updateFollowLabel = () => {
        if (!followLabel) return;
        const key = followInput && followInput.checked
            ? 'pad.historyMode.followOn'
            : 'pad.historyMode.followOff';
        const txt = html10n.get(key);
        if (!txt) return;
        followLabel.setAttribute('title', txt);
        followLabel.setAttribute('aria-label', txt);
      };
      updateFollowLabel();
      if (followInput && !(followInput as any)._padModeFollowBound) {
        followInput.addEventListener('change', updateFollowLabel);
        (followInput as any)._padModeFollowBound = true;
      }
    };
    apply();
    if (typeof html10n.bind === 'function') {
      html10n.bind('localized', apply);
    }
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
    const ctrl = document.getElementById('history-controls');
    if (ctrl) ctrl.removeAttribute('hidden');

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
    this.teardownBridges();
    this.unmountIframe();
    this.banner.setAttribute('hidden', '');
    this.mount.setAttribute('hidden', '');
    const ctrl = document.getElementById('history-controls');
    if (ctrl) ctrl.setAttribute('hidden', '');
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
    const stars = document.getElementById('history-slider-stars');
    if (stars) {
      stars.replaceChildren();
      stars.dataset.sig = '';
    }
  }

  // Restore everything entry-time we stashed: chat message visibility, the
  // chat replay header, the live users-panel HTML, original export hrefs,
  // and any DOM listeners we attached to outer Settings controls.
  private teardownBridges(): void {
    document.querySelectorAll<HTMLElement>('#chattext > p[data-timestamp]')
        .forEach((p) => { p.style.display = ''; });
    if (this.chatHeaderEl) this.chatHeaderEl.remove();
    this.chatHeaderEl = null;
    this.chatHeaderSnapshot = null;
    if (this.usersSnapshot != null) {
      const tbl = document.getElementById('otheruserstable');
      if (tbl) tbl.innerHTML = this.usersSnapshot;
      this.usersSnapshot = null;
    }
    if (this.exportSnapshot) {
      this.exportSnapshot.forEach((href, anchor) => { anchor.setAttribute('href', href); });
      this.exportSnapshot = null;
    }
    // Every outer Settings/history control we bound is tracked in one list,
    // so a single pass tears them all down. (The inner BroadcastSlider has no
    // removeCallback API, but the whole iframe is destroyed on exit so any
    // callbacks die with it.)
    this.outerControlListeners.forEach(({el, type, fn}) => el.removeEventListener(type, fn));
    this.outerControlListeners = [];
  }

  // Attach a listener to an outer control and register it for teardown on
  // exit. No-ops if the element is missing so callers can stay terse.
  private bindOuter(el: HTMLElement | null, type: string, fn: EventListener): void {
    if (!el) return;
    el.addEventListener(type, fn);
    this.outerControlListeners.push({el, type, fn});
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
    if (this.savedRevObserver) {
      this.savedRevObserver.disconnect();
      this.savedRevObserver = null;
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

    // Register a single slider callback that drives the outer pad's
    // historical-state UI: chat replay, authors-at-this-revision, and
    // export href rewriting. The callback fires once on initial setup
    // plus on every scrub.
    const inner: any = win as any;
    const registerHook = () => {
      const BS = inner.BroadcastSlider;
      if (!BS || typeof BS.onSlider !== 'function') {
        // Slider not initialized yet — try again on next frame.
        win.requestAnimationFrame(registerHook);
        return;
      }
      BS.onSlider((revno: number) => { this.onRevChange(revno, win); });
      // Drive the initial sync (the slider may have already fired before
      // we got here on a fast load).
      this.onRevChange(BS.getSliderPosition?.() ?? 0, win);
    };
    registerHook();

    this.snapshotForHistory();
    this.wireSettingsBridges(win);
    this.wireHistoryControls(win);
  }

  // Bind the outer #history-controls (slider input + play/pause/step
  // buttons) as a remote control for the embedded timeslider's
  // BroadcastSlider. The inner slider DOM stays present (the embed CSS
  // hides it) so its existing drag/click handlers continue to work — the
  // outer controls just push state into the same BroadcastSlider via its
  // public methods.
  private wireHistoryControls(innerWin: Window): void {
    const inner: any = innerWin as any;
    const sliderInput = document.getElementById('history-slider-input') as HTMLInputElement | null;
    const playBtn = document.getElementById('history-playpause') as HTMLButtonElement | null;
    const leftStep = document.getElementById('history-leftstep') as HTMLButtonElement | null;
    const rightStep = document.getElementById('history-rightstep') as HTMLButtonElement | null;
    const timer = document.getElementById('history-timer') as HTMLElement | null;

    this.bindOuter(sliderInput, 'input', () => {
      if (!sliderInput) return;
      const target = Math.max(0, Math.floor(Number(sliderInput.value) || 0));
      try { inner.BroadcastSlider?.setSliderPosition?.(target); } catch (_e) {}
    });
    this.bindOuter(playBtn, 'click', () => {
      try { inner.BroadcastSlider?.playpause?.(); } catch (_e) {}
    });
    // Inner #leftstep / #rightstep already wire all the step logic; just
    // forward the click so we share the same code path.
    this.bindOuter(leftStep, 'click', () => {
      try { (innerWin.document.getElementById('leftstep') as HTMLElement | null)?.click(); }
      catch (_e) {}
    });
    this.bindOuter(rightStep, 'click', () => {
      try { (innerWin.document.getElementById('rightstep') as HTMLElement | null)?.click(); }
      catch (_e) {}
    });

    // Mirror inner state into the outer controls. We register a
    // BroadcastSlider.onSlider callback (called on every position change)
    // and poll the inner #playpause_button_icon.pause class for play state.
    const sync = (revno: number) => {
      const max = inner.BroadcastSlider?.getSliderLength?.();
      if (sliderInput && typeof max === 'number' && Number(sliderInput.max) !== max) {
        sliderInput.max = String(max);
      }
      if (sliderInput && Number(sliderInput.value) !== revno) {
        sliderInput.value = String(revno);
      }
      if (timer) {
        const innerTimer = innerWin.document.getElementById('timer');
        if (innerTimer) timer.textContent = innerTimer.textContent || '';
      }
      if (playBtn) {
        const innerPlay = innerWin.document.getElementById('playpause_button_icon');
        const playing = !!innerPlay && innerPlay.classList.contains('pause');
        playBtn.classList.toggle('pause', playing);
        playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      }
      // Saved-revision markers depend on the slider max, which is only known
      // once the inner slider has reported its length — render them here so we
      // pick up the correct positions on first sync and on any max change.
      this.renderSavedRevisionStars(innerWin);
    };
    // The hook registered earlier in attachInnerBridges already calls
    // onRevChange — piggyback on it for slider input/timer updates by
    // chaining through the same listener path.
    const registerSync = () => {
      const BS = inner.BroadcastSlider;
      if (!BS || typeof BS.onSlider !== 'function') {
        innerWin.requestAnimationFrame(registerSync);
        return;
      }
      BS.onSlider(sync);
      sync(BS.getSliderPosition?.() ?? 0);
      // Now that the inner slider exists, watch it for live NEW_SAVEDREV stars.
      this.observeInnerSavedRevisions(innerWin);
    };
    registerSync();
  }

  // Mirror the embedded timeslider's saved revisions onto the outer slider as
  // clickable star markers (issue #7946). The inner slider draws its own stars
  // on #ui-slider-bar, but that DOM is hidden in embed mode, so users only see
  // the outer #history-slider-input — which had no markers.
  //
  // The inner #ui-slider-bar .star elements are the live source of truth: the
  // timeslider keeps them current as NEW_SAVEDREV messages arrive (each carries
  // a `pos` attribute = revNum), whereas clientVars.savedRevisions is only the
  // entry-time snapshot. We read positions from those stars and pull labels
  // from the snapshot where available. A signature guard keeps this cheap when
  // sync() fires on every scrub; positions are percentage-based so they reflow
  // on resize for free.
  private renderSavedRevisionStars(innerWin: Window): void {
    const inner: any = innerWin as any;
    const layer = document.getElementById('history-slider-stars');
    const sliderInput = document.getElementById('history-slider-input') as HTMLInputElement | null;
    if (!layer || !sliderInput || !innerWin.document) return;

    const max = Number(sliderInput.max) || 0;
    const revNums = Array.from(innerWin.document.querySelectorAll('#ui-slider-bar .star'))
        .map((el) => Number(el.getAttribute('pos')))
        // max === 0 is a valid single-revision pad: only rev 0 belongs there.
        .filter((n) => Number.isFinite(n) && n >= 0 && (max === 0 ? n === 0 : n <= max));

    if (revNums.length === 0 || max < 0) {
      if (layer.childElementCount) layer.replaceChildren();
      layer.dataset.sig = '';
      return;
    }

    // Labels live in the clientVars snapshot, keyed by revNum.
    const labels = new Map<number, string>();
    const snapshot = inner.clientVars?.savedRevisions;
    if (Array.isArray(snapshot)) {
      for (const r of snapshot) {
        const n = Number(r && r.revNum);
        if (Number.isFinite(n) && r && typeof r.label === 'string' && r.label) labels.set(n, r.label);
      }
    }

    const sig = `${max}:${[...revNums].sort((a, b) => a - b).join(',')}`;
    if (layer.dataset.sig === sig) return;
    layer.dataset.sig = sig;
    layer.replaceChildren();

    for (const revNum of revNums) {
      const frac = max === 0 ? 0 : revNum / max;
      // A purely visual marker (the layer is aria-hidden): keyboard/screen
      // reader users already reach any revision via the slider and step
      // buttons, so we mirror the legacy timeslider's mouse-only stars rather
      // than inject extra tab stops. The hover title aids mouse users; the
      // click is a convenience to jump straight to the saved point.
      const star = document.createElement('span');
      star.className = 'history-star';
      star.style.left = `${(frac * 100).toFixed(4)}%`;
      star.title = labels.get(revNum) || `Revision ${revNum}`;
      star.addEventListener('click', () => {
        try { inner.BroadcastSlider?.setSliderPosition?.(revNum); } catch (_e) { /* inner gone */ }
      });
      layer.appendChild(star);
    }
  }

  // Re-render the outer markers whenever the embedded slider adds a star
  // (NEW_SAVEDREV). Observing the inner #ui-slider-bar covers saved revisions
  // created live while history mode is open, which sync()'s scrub-driven
  // callback would otherwise miss until the next slider move.
  private observeInnerSavedRevisions(innerWin: Window): void {
    if (this.savedRevObserver) return;
    const bar = innerWin.document && innerWin.document.getElementById('ui-slider-bar');
    if (!bar) return;
    this.savedRevObserver = new MutationObserver(() => { this.renderSavedRevisionStars(innerWin); });
    this.savedRevObserver.observe(bar, {childList: true});
  }

  // Capture the live state we'll restore on exit: live chat message
  // visibility (just the timestamps — actual messages stay), live users
  // panel HTML, and current Export hrefs.
  private snapshotForHistory(): void {
    if (this.usersSnapshot == null) {
      const tbl = document.getElementById('otheruserstable');
      if (tbl) this.usersSnapshot = tbl.innerHTML;
    }
    if (this.exportSnapshot == null) {
      this.exportSnapshot = new Map();
      document.querySelectorAll<HTMLAnchorElement>(
          '#exportColumn a.exportlink, #export a.exportlink',
      ).forEach((a) => {
        if (a.hasAttribute('href')) this.exportSnapshot!.set(a, a.getAttribute('href') || '');
      });
    }
    // Inject the chat replay header above #chattext on first entry.
    if (!this.chatHeaderEl) {
      const chattext = document.getElementById('chattext');
      if (chattext && chattext.parentNode) {
        const header = document.createElement('div');
        header.id = 'history-chat-header';
        header.className = 'history-chat-header';
        header.setAttribute('data-l10n-id', 'pad.historyMode.chat.replayHeader');
        header.textContent = 'Chat as of —';
        this.chatHeaderSnapshot = {
          parent: chattext.parentNode as HTMLElement,
          sibling: chattext,
        };
        chattext.parentNode.insertBefore(header, chattext);
        this.chatHeaderEl = header;
      }
    }
  }

  // Called on every revision change while in history mode. Drives:
  //   - chat replay (filter rendered messages by timestamp)
  //   - authors-at-this-revision panel (mirrors inner #authorsList)
  //   - outer Export hrefs (point at /p/PAD/<rev>/export/<type>)
  private onRevChange(revno: number, innerWin: Window): void {
    const inner: any = innerWin as any;
    const ts = inner.padContents?.currentTime as number | undefined;
    if (typeof ts === 'number') {
      this.filterChatByTimestamp(ts);
      this.updateChatHeader(ts);
    }
    this.syncAuthorsPanel(innerWin);
    this.syncExportHrefs(revno);
  }

  private filterChatByTimestamp(asOf: number): void {
    document.querySelectorAll<HTMLElement>('#chattext > p[data-timestamp]')
        .forEach((p) => {
          const t = Number(p.getAttribute('data-timestamp'));
          p.style.display = Number.isFinite(t) && t > asOf ? 'none' : '';
        });
  }

  private updateChatHeader(asOf: number): void {
    if (!this.chatHeaderEl) return;
    const d = new Date(asOf);
    const z = (n: number) => String(n).padStart(2, '0');
    const time = `${z(d.getHours())}:${z(d.getMinutes())}`;
    // html10n.get is not always loaded; fall back to a literal string.
    const html10n: any = (window as any).html10n;
    const label = (html10n && typeof html10n.get === 'function')
        ? html10n.get('pad.historyMode.chat.replayHeader', {time})
        : `Chat as of ${time}`;
    this.chatHeaderEl.textContent = label;
  }

  // Mirror the inner timeslider's #authorsList (rendered by broadcast.ts)
  // into the outer users panel. We replace the live user table while in
  // history mode and restore it on exit.
  private syncAuthorsPanel(innerWin: Window): void {
    const innerAuthors = (innerWin.document as Document).getElementById('authorsList');
    const tbl = document.getElementById('otheruserstable');
    if (!innerAuthors || !tbl) return;
    const text = innerAuthors.textContent || '';
    tbl.innerHTML = '';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.className = 'history-authors-row';
    td.textContent = text;
    tr.appendChild(td);
    tbl.appendChild(tr);
  }

  // Rewrite outer export anchors so a click downloads the historical
  // revision instead of the live document. Etherpad already supports
  // /p/:pad/<rev>/export/<type>.
  private syncExportHrefs(revno: number): void {
    if (!this.exportSnapshot) return;
    this.exportSnapshot.forEach((origHref, anchor) => {
      const m = origHref.match(/^(.*\/p\/[^/]+)\/export\/([^/?#]+)/);
      if (!m) return;
      anchor.setAttribute('href', `${m[1]}/${revno}/export/${m[2]}`);
    });
  }

  // Outer Settings popup grew a "History playback" section. Drive the inner
  // BroadcastSlider state from those controls so the user sees one set of
  // controls regardless of mode.
  private wireSettingsBridges(innerWin: Window): void {
    const inner: any = innerWin as any;
    const speedSel = document.getElementById('history-playbackspeed') as HTMLSelectElement | null;
    const followCb = document.getElementById('history-options-followContents') as HTMLInputElement | null;

    if (speedSel) {
      // Initial sync: read existing inner cookie/setting if available.
      const innerSpeed = inner.document.getElementById('playbackspeed') as HTMLSelectElement | null;
      if (innerSpeed && innerSpeed.value) speedSel.value = innerSpeed.value;
      this.bindOuter(speedSel, 'change', () => {
        const v = speedSel.value || '100';
        try {
          inner.BroadcastSlider?.setPlaybackSpeed?.(v);
          if (innerSpeed) {
            innerSpeed.value = v;
            innerSpeed.dispatchEvent(new Event('change'));
          }
        } catch (_e) {}
      });
    }

    if (followCb) {
      const innerFollow = inner.document.getElementById('options-followContents') as HTMLInputElement | null;
      if (innerFollow) followCb.checked = !!innerFollow.checked;
      this.bindOuter(followCb, 'change', () => {
        if (!innerFollow) return;
        innerFollow.checked = followCb.checked;
        innerFollow.dispatchEvent(new Event('change'));
      });
    }

    // Authorship colours, font family and line numbers each appear in two
    // places in the outer Settings UI (the legacy popup ids and the
    // `#padsettings-…` pane), so bridge every id to the embedded slider's
    // matching view-setting method.
    const bridgeView = <T extends HTMLElement>(ids: string[], apply: (el: T) => void) =>
      ids.forEach((id) => {
        const el = document.getElementById(id) as T | null;
        this.bindOuter(el, 'change', () => { try { apply(el!); } catch (_e) {} });
      });
    bridgeView<HTMLInputElement>(['options-colorscheck', 'padsettings-options-colorscheck'],
        (cb) => inner.BroadcastSlider?.setShowAuthorColors?.(cb.checked));
    bridgeView<HTMLSelectElement>(['viewfontmenu', 'padsettings-viewfontmenu'],
        (sel) => inner.BroadcastSlider?.setPadFontFamily?.(sel.value));
    bridgeView<HTMLInputElement>(['options-linenoscheck', 'padsettings-options-linenoscheck'],
        (cb) => inner.BroadcastSlider?.setShowLineNumbers?.(cb.checked));
  }

  private setInnerRevision(rev: number): void {
    if (!this.iframe || !this.iframe.contentWindow) return;
    // The embedded timeslider treats #N as "go to revision N", so we must
    // NOT write #-1 (or #0 as a stand-in for "latest"); for "latest" we
    // jump to the slider's current upper bound, which broadcast_slider
    // exposes via its sliderLength on the iframe's `BroadcastSlider`.
    try {
      if (rev < 0) {
        const inner: any = this.iframe.contentWindow as any;
        const upper = inner?.BroadcastSlider?.getSliderLength?.();
        if (typeof upper === 'number') {
          this.iframe.contentWindow.location.hash = `#${upper}`;
        }
        // If BroadcastSlider isn't ready yet, leave the iframe alone — its
        // own init reads its hash and starts at the latest revision.
        return;
      }
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
      this.setInnerRevision(rev);
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
