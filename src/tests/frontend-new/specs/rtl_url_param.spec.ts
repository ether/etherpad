import {expect, test} from "@playwright/test";
import {appendQueryParams, goToNewPad} from "../helper/padHelper";

test.beforeEach(async ({page, browser}) => {
  const context = await browser.newContext();
  await context.clearCookies();
  await goToNewPad(page);
});

test.describe('RTL URL parameter', function () {
  test('rtl=true enables RTL mode', async function ({page}) {
    await appendQueryParams(page, {rtl: 'true'});
    await expect(page.locator('#options-rtlcheck')).toBeChecked();
  });

  test('rtl=false disables RTL mode after rtl=true', {tag: '@feature:rtl-toggle'}, async function ({page}) {
    // First enable RTL via URL
    await appendQueryParams(page, {rtl: 'true'});
    await expect(page.locator('#options-rtlcheck')).toBeChecked();

    // Now disable RTL via URL
    await appendQueryParams(page, {rtl: 'false'});
    await expect(page.locator('#options-rtlcheck')).not.toBeChecked();
  });

  test('no rtl param falls back to the pad setting after an RTL URL override', {tag: '@feature:rtl-toggle'}, async function ({page}) {
    // Enable RTL via URL for the current page load only
    await appendQueryParams(page, {rtl: 'true'});
    await expect(page.locator('#options-rtlcheck')).toBeChecked();

    // Reload without rtl param — the pad setting remains authoritative
    const url = page.url().replace(/[?&]rtl=true/, '');
    await page.goto(url);
    await page.waitForSelector('#editorcontainer.initialized');
    await expect(page.locator('#options-rtlcheck')).not.toBeChecked();
  });

  test('rtl content option flips only the pad inner contents, not the whole page', {tag: '@feature:rtl-toggle'}, async function ({page}) {
    await appendQueryParams(page, {rtl: 'true'});
    await expect(page.locator('#options-rtlcheck')).toBeChecked();

    // The inner editor document is flipped to RTL...
    const innerBody = page.frame('ace_inner')!.locator('#innerdocbody');
    await expect(innerBody).toHaveClass(/\brtl\b/);
    const innerDirection = await innerBody.evaluate((el) =>
      el.ownerDocument.defaultView!.getComputedStyle(el).direction);
    expect(innerDirection).toBe('rtl');

    // ...but the top-level page (toolbar, chrome) is governed by the UI
    // language, not the pad's RTL content option, and must stay LTR.
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });
});
