# PR4 — GDPR Configurable Privacy Banner

Fourth of five GDPR PRs (ether/etherpad#6701). Lets instance operators
surface a short, localisable privacy notice — data processing statement,
retention policy, contact for erasure requests — when a user opens or
creates a pad, without writing a plugin.

## Goals

- One `settings.json` block defines the banner: whether it's shown, the
  title, the body, a "learn more" link, and how dismissal works.
- Banner renders on every pad load when enabled. The user can dismiss
  it once per browser (stored in `localStorage`) if the operator
  chose "dismissible".
- Works with the `colibris` skin out of the box, no plugin required.
- Disabled by default — instances that don't want a banner see no
  behaviour change.

## Non-goals

- Markdown rendering. Body is plain text; HTML escaped at render.
- Consent recording / "I consent" persistence. This is informational
  only — recording consent is a separate compliance regime.
- Multi-language. Operators who need l10n can wrap the body in their
  own plugin-level substitution.
- Admin UI for editing the banner. Edits happen in `settings.json`.

## Design

### Settings

```jsonc
"privacyBanner": {
  /*
   * Master switch. Defaults to false so existing instances are unchanged.
   */
  "enabled": false,
  /*
   * Short heading shown in bold. Plain text, HTML is escaped.
   */
  "title": "Privacy notice",
  /*
   * Body text. Plain text, HTML is escaped. Newlines become <br>.
   */
  "body": "This instance processes pad content on our servers. See the linked policy for retention and how to request erasure.",
  /*
   * Optional URL appended as a "Learn more" link. Omit or set to null
   * to hide the link.
   */
  "learnMoreUrl": null,
  /*
   * One of:
   *   "dismissible" (default) — show a close button; dismissal persists
   *                             in localStorage under a per-instance key
   *   "sticky"                — no close button; banner shown every load
   */
  "dismissal": "dismissible"
}
```

`SettingsType` gains a matching strongly-typed block. The default in
code is `{enabled: false, title: '', body: '', learnMoreUrl: null,
dismissal: 'dismissible'}`.

### Server wiring

- `settings.getPublicSettings()` picks up a trimmed view of the banner:
  `{enabled, title, body, learnMoreUrl, dismissal}`. Nothing else from
  `privacyBanner` leaks.
- `PadMessageHandler` already sends `settings.getPublicSettings()` via
  `clientVars.skinName` etc. — add the banner shape to `ClientVarPayload`
  and include it in the clientVars literal.

### Template

- Add `<div id="privacy-banner" hidden>` to `src/templates/pad.html`,
  styled by the colibris skin. Collapsed by default.
- Contents: title `<strong>`, body `<p>` (each line becomes a `<p>` so
  newlines behave), optional `<a target="_blank" rel="noopener">`,
  and a `<button id="privacy-banner-close">` that's rendered only if
  `dismissal === "dismissible"`.
- Body text is written via textContent (not innerHTML) to avoid XSS.

### Client JS

New `src/static/js/privacy_banner.ts`:

```typescript
'use strict';

type BannerConfig = {
  enabled: boolean,
  title: string,
  body: string,
  learnMoreUrl: string | null,
  dismissal: 'dismissible' | 'sticky',
};

const storageKey = (url: string): string =>
    `etherpad.privacyBanner.dismissed:${new URL(url).origin}`;

export const showPrivacyBannerIfEnabled = (config: BannerConfig | undefined) => {
  if (!config || !config.enabled) return;
  const banner = document.getElementById('privacy-banner');
  if (banner == null) return;

  if (config.dismissal === 'dismissible' &&
      localStorage.getItem(storageKey(location.href)) === '1') {
    return;
  }

  (banner.querySelector('.privacy-banner-title') as HTMLElement).textContent =
      config.title;
  const bodyHost = banner.querySelector('.privacy-banner-body') as HTMLElement;
  bodyHost.textContent = '';
  for (const line of config.body.split(/\r?\n/)) {
    const p = document.createElement('p');
    p.textContent = line;
    bodyHost.appendChild(p);
  }
  const linkHost = banner.querySelector('.privacy-banner-link') as HTMLElement;
  if (config.learnMoreUrl) {
    const a = document.createElement('a');
    a.href = config.learnMoreUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Learn more';
    linkHost.replaceChildren(a);
  } else {
    linkHost.replaceChildren();
  }
  const closeBtn = banner.querySelector('#privacy-banner-close') as HTMLElement | null;
  if (config.dismissal === 'dismissible' && closeBtn) {
    closeBtn.hidden = false;
    closeBtn.addEventListener('click', () => {
      banner.hidden = true;
      try { localStorage.setItem(storageKey(location.href), '1'); } catch (_e) { /* best effort */ }
    });
  } else if (closeBtn) {
    closeBtn.hidden = true;
  }
  banner.hidden = false;
};
```

Called from `pad.ts` once after `postAceInit`, with
`clientVars.privacyBanner`.

### Tests

- **Settings unit** (`src/tests/backend/specs/privacyBanner.ts`):
  default shape matches, malformed `dismissal` falls back to
  `'dismissible'` on load.
- **Playwright**
  (`src/tests/frontend-new/specs/privacy_banner.spec.ts`):
    - disabled (default) → `#privacy-banner` stays `hidden`.
    - enabled + `sticky` → banner visible on load, no close button.
    - enabled + `dismissible` → close button toggles banner hidden and
      persists across reload via localStorage.
    - `learnMoreUrl` → `<a>` rendered with the right href, absent when
      null.
    - Body with two `\n\n` paragraphs → two `<p>` children.

Tests flip `settings.privacyBanner.enabled` at runtime and navigate to
a fresh pad; no server restart needed.

### Docs

- Add a short section to `doc/privacy.md` describing the banner and
  how to configure it.
- Add a one-line pointer from `doc/settings.md`'s existing layout to
  the privacy doc if `settings.md` has a section for this kind of
  block; otherwise leave `settings.json.template`'s inline comments as
  the authoritative reference.

## Risk / migration

- Default `enabled: false` keeps the UI quiet for every existing
  instance.
- Plain-text + textContent rendering avoids XSS even if operators
  copy-paste raw HTML into `body`.
- localStorage key is scoped per-origin, so multi-tenant proxy setups
  won't cross-contaminate dismissal state.
