import {expect, test} from '@playwright/test';
import {goToNewPad} from '../helper/padHelper.js';

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

test('export links have an accessible name from their localized content', async ({page}) => {
  await page.locator('button[data-l10n-id="pad.toolbar.import_export.title"]').click();
  // The Word/PDF/ODF export links are removed client-side by pad_impexp.ts
  // when soffice is not configured, so only assert on links that the
  // environment actually renders. For the ones that are present, their
  // accessible name comes from the localized child span (data-l10n-id
  // pad.importExport.exportetherpad etc.), not a hard-coded English
  // aria-label. Assert the visible text is non-empty, which is what a
  // screen reader will announce.
  const ids = [
    '#exportetherpada',
    '#exporthtmla',
    '#exportplaina',
    '#exportworda',
    '#exportpdfa',
    '#exportopena',
  ];
  for (const id of ids) {
    const locator = page.locator(id);
    if ((await locator.count()) === 0) continue;
    const text = (await locator.innerText()).trim();
    expect(text.length).toBeGreaterThan(0);
  }
});

test('chaticon is a button with an accessible name', async ({page}) => {
  const chatIcon = page.locator('#chaticon');
  const tagName = await chatIcon.evaluate((el) => el.tagName.toLowerCase());
  expect(tagName).toBe('button');
  // aria-label is populated by html10n from the pad.chat.title translation,
  // so we assert it is non-empty rather than a specific English string.
  const label = await chatIcon.getAttribute('aria-label');
  expect(label && label.length > 0).toBe(true);
});

test('chat header close/pin controls are buttons with accessible names', async ({page}) => {
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

test('show-more toolbar button has aria-label and aria-expanded', async ({page}) => {
  const btn = page.locator('.show-more-icon-btn');
  const tag = await btn.evaluate((el) => el.tagName.toLowerCase());
  expect(tag).toBe('button');
  await expect(btn).toHaveAttribute('aria-label', 'Show more toolbar buttons');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
});
