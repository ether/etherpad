# Accessibility: Dialog semantics, icon labels, html lang

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ARIA dialog semantics, focus management, accessible names for icon-only controls, and a `lang` attribute — addressing the highest-impact items from the 2026-04-22 a11y audit.

**Architecture:** All changes live in templates + a small set of TS files. No new modules. The existing `toggleDropDown` in `pad_editbar.ts` is the single chokepoint for popup show/hide; we extend it with focus management. Icon-only buttons get accessible names via a new `icon.*` locale namespace consumed via `data-l10n-id` (existing l10n machinery applies to `aria-label` automatically through html10n's attribute syntax).

**Tech Stack:** EJS templates, TypeScript, jQuery (legacy), Playwright tests.

**Out of scope:** WCAG-AA contrast pass, touch-target sizing (28→44px), full focus-visible CSS pass, modal-by-modal focus-trap library swap. Leaving those for follow-up PRs to keep this one reviewable.

---

### Task 1: Add `lang` attribute to top-level templates

**Files:**
- Modify: `src/templates/pad.html:7`
- Modify: `src/templates/index.html` (top `<html>` tag)
- Modify: `src/templates/timeslider.html` (top `<html>` tag)

The pad templates render server-side; `clientVars.userAgent` and `req.headers['accept-language']` aren't directly available here, but the rendered locale is exposed via `settings.defaultLang` in `Settings.ts`. Use that, defaulting to `en` if unset.

- [ ] **Step 1.1:** Edit `src/templates/pad.html` line 7. Replace
  ```html
  <html translate="no" class="pad <%=pluginUtils.clientPluginNames().join(' '); %> <%=settings.skinVariants%>">
  ```
  with
  ```html
  <html lang="<%=settings.defaultLang || 'en'%>" translate="no" class="pad <%=pluginUtils.clientPluginNames().join(' '); %> <%=settings.skinVariants%>">
  ```

- [ ] **Step 1.2:** Apply the same `lang` attribute to `src/templates/index.html` and `src/templates/timeslider.html` `<html>` tags. (Read each first to get exact current line.)

- [ ] **Step 1.3:** The client-side language switcher (`html10n`) already updates `documentElement.lang` after page load — verify by grepping `pad_utils.ts` and `vendors/html10n.ts` for `lang =`. No code change needed if html10n already does this; otherwise add one line in `pad.ts` after l10n loads to set `document.documentElement.lang` from the active locale.

- [ ] **Step 1.4:** Commit:
  ```bash
  git add src/templates/pad.html src/templates/index.html src/templates/timeslider.html
  git commit -m "fix(a11y): add lang attribute to top-level templates"
  ```

---

### Task 2: Dialog semantics on popups

**Files:**
- Modify: `src/templates/pad.html` — popups at lines 117 (`#settings`), 190 (`#import_export`), 242 (`#connectivity`), 325 (`#embed`), 349 (`#users`), 353 (`#mycolorpicker`), 410 (`#skin-variants`).

For each popup, add `role="dialog"`, `aria-modal="true"`, `aria-labelledby="<h1-id>"`. Where the popup has an `<h1>` without an id, add an id. Connectivity has multiple `<h1>` (one per state) — give that one `role="dialog" aria-modal="true" aria-label="Connection status"` instead of labelledby.

- [ ] **Step 2.1:** Settings popup. Add id to its `<h1>`:
  ```html
  <h1 id="settings-title" data-l10n-id="pad.settings.padSettings"></h1>
  ```
  And:
  ```html
  <div id="settings" class="popup" role="dialog" aria-modal="true" aria-labelledby="settings-title" hidden><div class="popup-content">
  ```
  Note: add `hidden` so the dialog is not announced to screen readers when closed. The existing `.popup-show` class already controls visibility via CSS; we'll toggle the `hidden` attribute alongside it in Task 3.

- [ ] **Step 2.2:** Import/export popup — add id `importexport-title` to its `<h1>`, add same dialog attrs.

- [ ] **Step 2.3:** Connectivity popup — `aria-label="Connection status"` (no labelledby; label is generic since the h1 changes per state).

- [ ] **Step 2.4:** Embed popup — id `embed-title` on the `<h1>`, dialog attrs.

- [ ] **Step 2.5:** Users popup — `aria-label="Users on this pad"` (no `<h1>` in the markup).

- [ ] **Step 2.6:** Mycolorpicker — `aria-label="Choose your author color"`.

- [ ] **Step 2.7:** Skin-variants popup — id `skin-variants-title` on its `<h1>`, dialog attrs.

- [ ] **Step 2.8:** Fix the `aria-role="document"` typo on `#otherusers` (pad.html:366) → replace with `role="region" aria-live="polite" aria-label="Active users on this pad"`. (`aria-role` is not a real attribute — it's `role`.)

- [ ] **Step 2.9:** Commit:
  ```bash
  git add src/templates/pad.html
  git commit -m "fix(a11y): dialog semantics on popups; fix aria-role typo on userlist"
  ```

---

### Task 3: Focus management in `toggleDropDown`

**Files:**
- Modify: `src/static/js/pad_editbar.ts:209-256` (the `toggleDropDown` method)

When opening a popup: remember the trigger element, move focus to the first focusable element inside the popup, set `hidden=false`. When closing: set `hidden=true`, restore focus to the trigger. Add an Escape handler that closes any open popup.

- [ ] **Step 3.1:** At the top of the `padeditbar` class (find the existing field declarations near the constructor), add:
  ```ts
  private lastTrigger: HTMLElement | null = null;
  ```

- [ ] **Step 3.2:** Replace the body of `toggleDropDown(moduleName, cb = null)` to:
  - Remember `document.activeElement` as `lastTrigger` when transitioning from no-popup to popup-open.
  - After applying classes, for each module that became visible, set `module.attr('hidden', null)`; for each that became hidden, set `module.attr('hidden', '')`.
  - When transitioning to "all closed" (moduleName === 'none' or all modules ended up hidden), and `lastTrigger` is set and is still in the DOM, call `lastTrigger.focus()` then clear `lastTrigger`.
  - When opening, after a `requestAnimationFrame`, focus the first focusable inside the now-visible popup (`module.find('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])').filter(':visible').first().trigger('focus')`).

  Show full code:
  ```ts
  toggleDropDown(moduleName, cb = null) {
    let cbErr = null;
    try {
      if (moduleName === 'users' && $('#users').hasClass('stickyUsers')) return;

      $('.nice-select').removeClass('open');
      $('.toolbar-popup').removeClass('popup-show');

      const wasAnyOpen = $('.popup.popup-show').length > 0;
      if (!wasAnyOpen && moduleName !== 'none') {
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body) this.lastTrigger = active;
      }

      let openedModule: JQuery<HTMLElement> | null = null;

      if (moduleName === 'none') {
        for (const thisModuleName of this.dropdowns) {
          if (thisModuleName === 'users') continue;
          const module = $(`#${thisModuleName}`);
          const isAForceReconnectMessage = module.find('button#forcereconnect:visible').length > 0;
          if (isAForceReconnectMessage) continue;
          if (module.hasClass('popup-show')) {
            $(`li[data-key=${thisModuleName}] > a`).removeClass('selected');
            module.removeClass('popup-show');
            module.attr('hidden', '');
          }
        }
      } else {
        for (const thisModuleName of this.dropdowns) {
          const module = $(`#${thisModuleName}`);
          if (module.hasClass('popup-show')) {
            $(`li[data-key=${thisModuleName}] > a`).removeClass('selected');
            module.removeClass('popup-show');
            module.attr('hidden', '');
          } else if (thisModuleName === moduleName) {
            $(`li[data-key=${thisModuleName}] > a`).addClass('selected');
            module.addClass('popup-show');
            module.removeAttr('hidden');
            openedModule = module;
          }
        }
      }

      if (openedModule) {
        const target = openedModule;
        requestAnimationFrame(() => {
          const focusable = target.find(
            'button:visible, a[href]:visible, input:visible, select:visible, textarea:visible, [tabindex]:not([tabindex="-1"]):visible'
          ).first();
          if (focusable.length) (focusable[0] as HTMLElement).focus();
        });
      } else if ($('.popup.popup-show').length === 0 && this.lastTrigger) {
        const trigger = this.lastTrigger;
        this.lastTrigger = null;
        if (document.body.contains(trigger)) trigger.focus();
      }
    } catch (err) {
      cbErr = err || new Error(err);
    } finally {
      if (cb) Promise.resolve().then(() => cb(cbErr));
    }
  }
  ```

- [ ] **Step 3.3:** Add a global keydown handler. Find the existing `init()` method (or wherever document-level handlers are bound — likely in `padeditbar.init` which is called from `pad.ts`). At the end of `init()`, add:
  ```ts
  $(document).on('keydown', (e) => {
    if (e.key === 'Escape' && $('.popup.popup-show').length > 0) {
      this.toggleDropDown('none');
      e.preventDefault();
    }
  });
  ```

- [ ] **Step 3.4:** Run tsc to confirm types compile:
  ```bash
  pnpm --dir src run ts-check
  ```
  Expected: no new errors in `pad_editbar.ts`.

- [ ] **Step 3.5:** Commit:
  ```bash
  git add src/static/js/pad_editbar.ts
  git commit -m "fix(a11y): focus management and Escape-to-close for popups"
  ```

---

### Task 4: Make chat icon a real button + label its close/stick controls

**Files:**
- Modify: `src/templates/pad.html:380` (`#chaticon` div → button)
- Modify: `src/templates/pad.html:390-391` (`#titlecross`, `#titlesticky` anchors → buttons)
- Modify: `src/static/js/chat.ts` if any code reads `#chaticon` as a div (grep first)

- [ ] **Step 4.1:** Grep for `chaticon` references in JS/CSS so we don't break selectors:
  ```bash
  grep -rn "chaticon" src/static/js src/static/css src/static/skins
  ```
  Expected: CSS targets `#chaticon`; JS reads `.click()` / `.show()`. None of these care whether it's a div or a button.

- [ ] **Step 4.2:** Replace the chat icon block with:
  ```html
  <button type="button" id="chaticon" class="visible" title="Chat (Alt C)" aria-label="Open chat" data-l10n-id="pad.chat.title">
      <span id="chatlabel" data-l10n-id="pad.chat"></span>
      <span class="buttonicon buttonicon-chat" aria-hidden="true"></span>
      <span id="chatcounter" aria-label="Unread messages">0</span>
  </button>
  ```
  Move the `onclick="chat.show();return false;"` to a JS handler in `chat.ts` `init()` (find existing init):
  ```ts
  $('#chaticon').on('click', (e) => { e.preventDefault(); chat.show(); });
  ```
  (If `chat.show()` is already wired by another listener, just remove the inline `onclick` and rely on the existing handler — confirm by greping.)

- [ ] **Step 4.3:** Replace chat header close/stick anchors:
  ```html
  <button type="button" id="titlecross" class="hide-reduce-btn" aria-label="Close chat">−</button>
  <button type="button" id="titlesticky" class="stick-to-screen-btn" aria-label="Pin chat to screen" data-l10n-id="pad.chat.stick.title">▮</button>
  ```
  Move their inline `onClick` handlers to `chat.ts`:
  ```ts
  $('#titlecross').on('click', (e) => { e.preventDefault(); chat.hide(); });
  $('#titlesticky').on('click', (e) => { e.preventDefault(); chat.stickToScreen(true); });
  ```

- [ ] **Step 4.4:** Inspect CSS for `#chaticon` / `#titlecross` / `#titlesticky`. Buttons get default browser styling (border, padding) that may break the layout. Add a CSS reset block in `src/static/css/pad/chat.css` (or wherever those selectors already live):
  ```css
  #chaticon, #titlecross, #titlesticky {
    background: transparent;
    border: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  #chaticon:focus-visible, #titlecross:focus-visible, #titlesticky:focus-visible {
    outline: 2px solid #0066cc;
    outline-offset: 2px;
  }
  ```
  Find the right file by grepping `#chaticon` in `src/static/css`.

- [ ] **Step 4.5:** ts-check:
  ```bash
  pnpm --dir src run ts-check
  ```

- [ ] **Step 4.6:** Commit:
  ```bash
  git add src/templates/pad.html src/static/js/chat.ts src/static/css
  git commit -m "fix(a11y): make chaticon and chat header controls real buttons"
  ```

---

### Task 5: Add `icon.*` locale namespace and label icon-only controls

**Files:**
- Modify: `src/locales/en.json` — add new keys
- Modify: `src/templates/pad.html` — apply `data-l10n-id` to `aria-label` on icon-only elements

html10n supports per-attribute translation via `key.attr` style — for `aria-label`, the convention used elsewhere in this codebase is `data-l10n-id="key"` plus a sibling key `key.aria-label`. Check existing usage by grepping `aria-label` in `src/locales/en.json`:

- [ ] **Step 5.1:** Grep current usage:
  ```bash
  grep -n "aria-label\|.title" src/locales/en.json | head -20
  ```
  Determine the convention. If html10n uses `{key}.aria-label`, follow that. Otherwise use plain `key` and apply via `aria-label` directly in HTML (no l10n on the aria-label) and accept English-only for now.

- [ ] **Step 5.2:** Add to `src/locales/en.json` after the `pad.chat.*` block:
  ```json
  "pad.icon.export.etherpad": "Export as Etherpad",
  "pad.icon.export.html": "Export as HTML",
  "pad.icon.export.plain": "Export as plain text",
  "pad.icon.export.word": "Export as Microsoft Word",
  "pad.icon.export.pdf": "Export as PDF",
  "pad.icon.export.opendocument": "Export as ODF",
  "pad.icon.showmore": "Show more toolbar buttons",
  ```
  (Insert with correct JSON commas.)

- [ ] **Step 5.3:** Apply to the export `<a>` elements in `src/templates/pad.html:215-232`:
  ```html
  <a id="exportetherpada" target="_blank" class="exportlink" aria-label="Export as Etherpad" data-l10n-id="pad.icon.export.etherpad">
  ```
  Repeat per format. Add `aria-hidden="true"` to the inner `<span class="exporttype buttonicon ...">` since the link itself now carries the label.

- [ ] **Step 5.4:** Convert the show-more span to a button on `pad.html:74`:
  ```html
  <button type="button" class="show-more-icon-btn" aria-label="Show more toolbar buttons" data-l10n-id="pad.icon.showmore"></button>
  ```
  Verify CSS targeting `.show-more-icon-btn` doesn't depend on element type — grep first.

- [ ] **Step 5.5:** Theme switcher knob (`pad.html:172`) currently has `aria-label="theme-switcher-knob"` which is a CSS-class-style label, not human text. Change to `aria-label="Toggle theme"`.

- [ ] **Step 5.6:** Commit:
  ```bash
  git add src/locales/en.json src/templates/pad.html
  git commit -m "fix(a11y): accessible names for icon-only buttons and links"
  ```

---

### Task 6: Playwright test for dialog semantics + Escape

**Files:**
- Create: `src/tests/frontend-new/specs/a11y_dialogs.spec.ts`

Cover the high-impact promises: settings popup opens with role=dialog, Escape closes it, focus returns to trigger.

- [ ] **Step 6.1:** Write the failing test:
  ```ts
  import {expect, test} from "@playwright/test";
  import {goToNewPad} from "../helper/padHelper";

  test.beforeEach(async ({page}) => { await goToNewPad(page); });

  test('settings popup has dialog semantics and Escape closes it', async ({page}) => {
    const settingsButton = page.locator('.buttonicon.buttonicon-cog');
    await settingsButton.click();

    const dialog = page.locator('#settings');
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Focus should return to the trigger
    const focused = await page.evaluate(() => document.activeElement?.className || '');
    expect(focused).toContain('buttonicon-cog');
  });

  test('html element has lang attribute', async ({page}) => {
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBeTruthy();
    expect(lang!.length).toBeGreaterThan(0);
  });

  test('export links have accessible names', async ({page}) => {
    await page.locator('.buttonicon.buttonicon-import_export').click();
    const pdfLink = page.locator('#exportpdfa');
    const label = await pdfLink.getAttribute('aria-label');
    expect(label).toBeTruthy();
  });

  test('chaticon is a button with accessible name', async ({page}) => {
    const chatIcon = page.locator('#chaticon');
    const tagName = await chatIcon.evaluate(el => el.tagName.toLowerCase());
    expect(tagName).toBe('button');
    const label = await chatIcon.getAttribute('aria-label');
    expect(label).toBeTruthy();
  });
  ```

- [ ] **Step 6.2:** Verify the Playwright spec runs (headless per project rule):
  ```bash
  cd src && pnpm exec playwright test tests/frontend-new/specs/a11y_dialogs.spec.ts --reporter=list
  ```
  Expected: all 4 tests pass.

- [ ] **Step 6.3:** Commit:
  ```bash
  git add src/tests/frontend-new/specs/a11y_dialogs.spec.ts
  git commit -m "test(a11y): verify dialog semantics, html lang, export labels, chat button"
  ```

---

### Task 7: Run the full local checks before push

- [ ] **Step 7.1:** ts-check from `src/`:
  ```bash
  pnpm --dir src run ts-check
  ```

- [ ] **Step 7.2:** Backend tests:
  ```bash
  pnpm --dir src run test:backend
  ```

- [ ] **Step 7.3:** Push and open a PR against `johnmclear/etherpad-lite`:
  ```bash
  git push -u fork fix/a11y-dialogs-labels-lang
  gh pr create --repo johnmclear/etherpad-lite --base develop --head fix/a11y-dialogs-labels-lang \
    --title "fix(a11y): dialog semantics, icon labels, html lang" \
    --body "..."
  ```

- [ ] **Step 7.4:** Post `/review` comment on the PR to trigger Qodo.

---

## Self-review notes

- **Spec coverage:** Original audit's high-impact items were (a) dialog semantics + focus trap, (b) aria-labels via icon.* namespace, (c) html lang. All three covered (Tasks 2+3, 4+5, 1). Bonus: aria-role typo on userlist (Task 2.8) and chat header buttons (Task 4.3).
- **Out of scope, deliberately:** focus-visible CSS sweep, contrast pass, touch-target sizing, full focus-trap library (we do simple init-focus + Escape, not Tab cycling — adequate for these short popups, library can come later).
- **Risk:** Adding `hidden` attribute to popups changes initial render — confirmed CSS does not depend on absence of `hidden` (CSS uses `.popup-show` to display). Need to check that `display: none` from `.popup` (default) and `hidden` don't conflict in unwanted ways; `hidden` is a stronger signal and should be fine.
