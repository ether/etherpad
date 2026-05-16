import {expect, test} from '@playwright/test';
import {goToNewPad} from '../helper/padHelper';

// Pin browser locale so html10n picks the English bundle. Several
// assertions in this file compare against specific English strings
// (e.g. "Close chat", "Export as Etherpad"); without this, translatewiki
// updates would localise those strings and break the suite.
test.use({locale: 'en-US'});

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

test('html element has a non-empty lang attribute', async ({page}) => {
  const lang = await page.locator('html').getAttribute('lang');
  expect(lang).toBeTruthy();
  expect(lang!.length).toBeGreaterThan(0);
});

test('settings popup has dialog semantics, Escape closes it, focus returns to trigger', async ({page}) => {
  const settingsButton = page.locator('button[data-l10n-id="pad.toolbar.settings.title"]');
  await settingsButton.click();

  const dialog = page.locator('#settings');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAttribute('aria-labelledby', 'settings-title');
  await expect(dialog).toHaveClass(/popup-show/);

  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveClass(/popup-show/);

  // Focus should return to the trigger button (the cog icon).
  const focusedL10nId =
      await page.evaluate(() => document.activeElement?.getAttribute('data-l10n-id') || '');
  expect(focusedL10nId).toBe('pad.toolbar.settings.title');
});

test('import_export popup has dialog semantics', async ({page}) => {
  await page.locator('button[data-l10n-id="pad.toolbar.import_export.title"]').click();
  const dialog = page.locator('#import_export');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAttribute('aria-labelledby', 'importexport-title');
});

test('embed popup has dialog semantics', async ({page}) => {
  await page.locator('button[data-l10n-id="pad.toolbar.embed.title"]').click();
  const dialog = page.locator('#embed');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAttribute('aria-labelledby', 'embed-title');
});

test('users popup has dialog semantics with aria-label', async ({page}) => {
  await page.locator('button[data-l10n-id="pad.toolbar.showusers.title"]').click();
  const dialog = page.locator('#users');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAttribute('aria-label', 'Users on this pad');
});

test('users popup closes on Escape even when focus is outside the popup', async ({page}) => {
  // Opening #users leaves focus in the ace editor iframe because its only
  // would-be-focusable element (#myusernameedit) is disabled. Esc must still
  // dismiss the dialog. Regression for PR #7584 review feedback.
  await page.locator('button[data-l10n-id="pad.toolbar.showusers.title"]').click();
  const dialog = page.locator('#users');
  await expect(dialog).toHaveClass(/popup-show/);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveClass(/popup-show/);
});

test('export links have a localized aria-label and matching title', async ({page}) => {
  await page.locator('button[data-l10n-id="pad.toolbar.import_export.title"]').click();
  // The Word/PDF/ODF export links are removed client-side by pad_impexp.ts
  // when soffice is not configured, so only assert on links that the
  // environment actually renders. Each anchor carries
  // data-l10n-id="pad.importExport.export<format>a.title", which html10n
  // expands into both `title` and `aria-label` from the same translation
  // (e.g. "Export as Etherpad"). The inner icon span is aria-hidden so a
  // screen reader announces the anchor's label once, not twice.
  const cases: Array<[string, string]> = [
    ['#exportetherpada', 'Export as Etherpad'],
    ['#exporthtmla', 'Export as HTML'],
    ['#exportplaina', 'Export as plain text'],
    ['#exportworda', 'Export as Microsoft Word'],
    ['#exportpdfa', 'Export as PDF'],
    ['#exportopena', 'Export as ODF (Open Document Format)'],
  ];
  for (const [id, expected] of cases) {
    const locator = page.locator(id);
    if ((await locator.count()) === 0) continue;
    await expect(locator).toHaveAttribute('aria-label', expected);
    await expect(locator).toHaveAttribute('title', expected);
    await expect(locator).toHaveAttribute('rel', 'noopener');
    const innerSpan = locator.locator('span.exporttype');
    await expect(innerSpan).toHaveAttribute('aria-hidden', 'true');
  }
});

test('chaticon is a button with an accessible name', {
  tag: '@feature:chat',
}, async ({page}) => {
  const chatIcon = page.locator('#chaticon');
  const tagName = await chatIcon.evaluate((el) => el.tagName.toLowerCase());
  expect(tagName).toBe('button');
  // aria-label is populated by html10n from the pad.chat.title translation,
  // so we assert it is non-empty rather than a specific English string.
  const label = await chatIcon.getAttribute('aria-label');
  expect(label && label.length > 0).toBe(true);
});

test('chat header close/pin controls are buttons with accessible names', {
  tag: '@feature:chat',
}, async ({page}) => {
  await page.locator('#chaticon').click();
  // #titlecross has no data-l10n-id so its aria-label stays static English.
  // #titlesticky has data-l10n-id, so html10n fills aria-label from the
  // translation; assert non-empty rather than a specific value.
  const close = page.locator('#titlecross');
  expect(await close.evaluate((n) => n.tagName.toLowerCase())).toBe('button');
  await expect(close).toHaveAttribute('aria-label', 'Close chat');

  const sticky = page.locator('#titlesticky');
  expect(await sticky.evaluate((n) => n.tagName.toLowerCase())).toBe('button');
  const stickyLabel = await sticky.getAttribute('aria-label');
  expect(stickyLabel && stickyLabel.length > 0).toBe(true);
});

test('otherusers region has aria-live and aria-label (no aria-role typo)', async ({page}) => {
  await page.locator('button[data-l10n-id="pad.toolbar.showusers.title"]').click();
  const region = page.locator('#otherusers');
  await expect(region).toHaveAttribute('role', 'region');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region).toHaveAttribute('aria-label', 'Active users on this pad');
  // The deprecated aria-role attribute should not appear.
  const ariaRole = await region.getAttribute('aria-role');
  expect(ariaRole).toBeNull();
});

test('show-more toolbar button has an accessible name and aria-expanded', async ({page}) => {
  const btn = page.locator('.show-more-icon-btn');
  const tag = await btn.evaluate((el) => el.tagName.toLowerCase());
  expect(tag).toBe('button');
  // The accessible name is supplied by aria-labelledby pointing at a hidden
  // localized span (so html10n can translate it). Verify the relationship
  // resolves and produces the expected English string with locale=en-US.
  await expect(btn).toHaveAttribute('aria-labelledby', 'editbar-showmore-label');
  await expect(page.locator('#editbar-showmore-label')).toHaveText('Show more toolbar buttons');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
});

test('editbar toolbars have role=toolbar with accessible names (#7255)', async ({page}) => {
  // Lighthouse + AT tooling (firefox a11y inspector) flagged both <ul> toolbars
  // as unnamed in the 2026-05-16 follow-up on #7255. Each toolbar role now
  // points to a hidden localized span via aria-labelledby; if either span is
  // ever removed, getAttribute returns an id with no matching element and the
  // toolbar becomes unnamed again — so assert the resolved string, not just
  // the attribute wiring.
  const cases: Array<[string, string, string]> = [
    ['.menu_left', 'editbar-formatting-label', 'Formatting toolbar'],
    ['.menu_right', 'editbar-actions-label', 'Pad actions toolbar'],
    // History toolbar reuses pad.historyMode.controlsLabel (already
    // translated in multiple locales) instead of a new English-only key.
    ['#history-controls', 'editbar-history-label', 'Pad history controls'],
  ];
  for (const [sel, labelId, expected] of cases) {
    const toolbar = page.locator(sel);
    await expect(toolbar).toHaveAttribute('role', 'toolbar');
    await expect(toolbar).toHaveAttribute('aria-labelledby', labelId);
    await expect(page.locator(`#${labelId}`)).toHaveText(expected);
  }
});

test('toolbar <li>/<a> wrappers are presentational (Lighthouse listitem rule, #7255)', async ({page}) => {
  // Lighthouse / axe-core's `listitem` rule flags <li> children of any
  // element whose role isn't `list` — and role="toolbar" on the <ul>
  // overrides the implicit list role. Murphy's #7255 follow-up included
  // the Lighthouse screenshot of this exact failure. role="presentation"
  // tells axe-core the <li>+<a> wrappers are layout scaffolding, while
  // the inner <button> retains button semantics for AT.
  const listItems = page.locator('.menu_left > li, .menu_right > li');
  const count = await listItems.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await expect(listItems.nth(i)).toHaveAttribute('role', 'presentation');
  }
  // Core's toolbar.ts emits items as <li><a><button>...</button></a></li>;
  // for those, the wrapping <a> is presentational so AT focus lands on the
  // <button>, not the empty link. Plugins may emit anchors with their own
  // role (e.g. ep_subscript_and_superscript renders <a role="button">), so
  // scope this assertion to core's button-wrappers only — `:has(> button)`
  // matches the <a> that contain a <button> child, which is what core emits.
  const anchors = page.locator(
      '.menu_left > li:not(.separator) > a:has(> button), ' +
      '.menu_right > li:not(.separator) > a:has(> button)');
  const aCount = await anchors.count();
  expect(aCount).toBeGreaterThan(0);
  for (let i = 0; i < aCount; i++) {
    await expect(anchors.nth(i)).toHaveAttribute('role', 'presentation');
  }
});

test('online_count badge has a localized accessible label (#7255)', async ({page}) => {
  // The user-count badge in the showusers toolbar button used to expose a
  // bare digit ("5") to AT, with no clue it was a user count. Now the badge
  // carries an aria-label generated from pad.userlist.onlineCount that
  // updates whenever the count changes. role=status + aria-live=polite
  // means AT announces the change without the user having to refocus.
  const badge = page.locator('#online_count');
  await expect(badge).toHaveAttribute('role', 'status');
  await expect(badge).toHaveAttribute('aria-live', 'polite');
  // toHaveText / toHaveAttribute poll so the assertions survive the
  // initial userlist init() pass (which appends the span and then sets
  // its aria-label asynchronously after html10n + setMyUserInfo land).
  await expect(badge).toHaveText(/^\d+$/);
  // English plural form contains "connected user" — covers both singular
  // and plural without baking the exact count into the test.
  await expect(badge).toHaveAttribute('aria-label', /connected user/);
});

test('linemetricsdiv is hidden from screen readers (#7255)', async ({page}) => {
  // The "Ether X" announcement in the issue's a11y-inspector screenshot was
  // the outer iframe (titled "Ether") plus a single "x" text leaf from
  // ace.ts's linemetricsdiv. linemetricsdiv is a measurement-only node — it
  // holds a single "x" so the renderer can read its computed line height —
  // and must stay out of the AT tree.
  const outerFrame = page.frameLocator('iframe[name="ace_outer"]');
  await expect(outerFrame.locator('#linemetricsdiv')).toHaveAttribute('aria-hidden', 'true');
});

test('skip-to-content link bypasses toolbar (WCAG 2.4.1, #7255)', async ({page}) => {
  const skip = page.locator('#skip-to-content');
  // It exists in the DOM and is hidden from sighted users by default —
  // sr-only-style positioning (top: -100px) keeps it offscreen.
  await expect(skip).toHaveAttribute('href', '#editorcontainer');
  // html10n should fill the visible text from the locale.
  await expect(skip).toHaveText('Skip to editor');
  // Activating moves focus into the editor iframe (ace_focus → targetBody).
  await skip.focus();
  await skip.press('Enter');
  // Focus now sits on the inner ace iframe wrapper, not on the skip link.
  const focusedId = await page.evaluate(() => document.activeElement?.id || '');
  expect(focusedId).not.toBe('skip-to-content');
});

test('skip link is the first Tab target from a fresh page (WCAG 2.4.1, #7255)', async ({page}) => {
  // Don't assert what happens to be focused after page load — plugins,
  // banners, or the privacy-token modal can grab focus before the test
  // runs, and the actual invariant we care about is tab order, not the
  // starting point. Defocus first, then press Tab from a known state.
  await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && typeof a.blur === 'function') a.blur();
  });
  await page.keyboard.press('Tab');
  const afterTabId = await page.evaluate(() => document.activeElement?.id || '');
  expect(afterTabId).toBe('skip-to-content');
});

test('editor-keyboard-hint exists in the editor iframe with localized text (#7255)', async ({page}) => {
  // Regression: PR #7451 added #editor-keyboard-hint as the target of the
  // editor body's aria-describedby. The hint was being wiped by
  // Ace2Inner.init()'s body management before it could be announced;
  // PR #7758 reworked the insertion to run after doActionsPendingInit().
  // Assert here that the hint actually exists post-init and carries the
  // localized string — without this test, future ace internals changes
  // could silently reintroduce the wipe.
  const innerFrame = page.frameLocator('iframe[name="ace_outer"]')
      .frameLocator('iframe[name="ace_inner"]');
  const hint = innerFrame.locator('#editor-keyboard-hint');
  await expect(hint).toHaveCount(1);
  // html10n may take a moment to populate; toHaveText polls. The string is
  // mandatory (mandatory English fallback in ace.ts), so neither '' nor
  // 'undefined' is acceptable.
  const text = await hint.textContent();
  expect(text && text.length > 0).toBe(true);
  expect(text).not.toBe('undefined');
  expect(text).toContain('Escape');
});

test('innerdocbody does not advertise role=textbox / aria-multiline (#7778)', async ({page}) => {
  // role=textbox + aria-multiline force NVDA/JAWS into focus mode for the
  // whole pad, which hides links/headings from the rotor and stops
  // arrow-key line navigation. Keep these attributes absent so AT browses
  // the editor as document content. The aria-label / aria-describedby
  // (#editor-keyboard-hint) stay — they don't change AT mode.
  const innerFrame = page.frameLocator('iframe[name="ace_outer"]')
      .frameLocator('iframe[name="ace_inner"]');
  const body = innerFrame.locator('body#innerdocbody');
  await expect(body).toHaveCount(1);
  expect(await body.getAttribute('role')).toBeNull();
  expect(await body.getAttribute('aria-multiline')).toBeNull();
  await expect(body).toHaveAttribute('aria-label', 'Pad content');
  await expect(body).toHaveAttribute('aria-describedby', 'editor-keyboard-hint');
});

test('line-number sidediv is hidden from screen readers (#7255)', async ({page}) => {
  // sidediv lives in the outer ace iframe (ace_outer) — query the frame.
  const outerFrame = page.frameLocator('iframe[name="ace_outer"]');
  await expect(outerFrame.locator('#sidediv')).toHaveAttribute('aria-hidden', 'true');
});
