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
    // The top-level page direction is owned by the UI language, not the pad's
    // RTL content option. Capture whatever the language chose so the assertion
    // is locale-independent (it could legitimately be rtl on an RTL locale).
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', /^(ltr|rtl)$/);
    const initialPageDir = await html.getAttribute('dir');

    await appendQueryParams(page, {rtl: 'true'});
    await expect(page.locator('#options-rtlcheck')).toBeChecked();

    // The inner editor document is flipped to RTL. Use a frameLocator chain so
    // Playwright auto-waits for the nested iframes/body to be ready.
    const innerBody = page
      .frameLocator('iframe[name="ace_outer"]')
      .frameLocator('iframe[name="ace_inner"]')
      .locator('#innerdocbody');
    await expect(innerBody).toHaveClass(/\brtl\b/);
    await expect.poll(() => innerBody.evaluate((el) =>
      el.ownerDocument.defaultView!.getComputedStyle(el).direction)).toBe('rtl');

    // ...but the top-level page (toolbar, chrome) is unaffected: its dir is
    // whatever the UI language set and must not change when the pad flips.
    await expect(html).toHaveAttribute('dir', initialPageDir!);
  });
});
