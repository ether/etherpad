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

  test('rtl=false disables RTL mode after rtl=true', async function ({page}) {
    // First enable RTL via URL
    await appendQueryParams(page, {rtl: 'true'});
    await expect(page.locator('#options-rtlcheck')).toBeChecked();

    // Now disable RTL via URL
    await appendQueryParams(page, {rtl: 'false'});
    await expect(page.locator('#options-rtlcheck')).not.toBeChecked();
  });

  test('no rtl param preserves cookie-based RTL preference', async function ({page}) {
    // Enable RTL via URL (which also sets the cookie)
    await appendQueryParams(page, {rtl: 'true'});
    await expect(page.locator('#options-rtlcheck')).toBeChecked();

    // Reload without rtl param — cookie should preserve RTL
    const url = page.url().replace(/[?&]rtl=true/, '');
    await page.goto(url);
    await page.waitForSelector('#editorcontainer.initialized');
    await expect(page.locator('#options-rtlcheck')).toBeChecked();
  });
});
