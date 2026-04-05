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
    const isRtl = await page.locator('#options-rtlcheck').isChecked();
    expect(isRtl).toBe(true);
  });

  test('rtl=false disables RTL mode after rtl=true', async function ({page}) {
    // First enable RTL via URL
    await appendQueryParams(page, {rtl: 'true'});
    let isRtl = await page.locator('#options-rtlcheck').isChecked();
    expect(isRtl).toBe(true);

    // Now disable RTL via URL
    await appendQueryParams(page, {rtl: 'false'});
    isRtl = await page.locator('#options-rtlcheck').isChecked();
    expect(isRtl).toBe(false);
  });

  test('no rtl param preserves cookie-based RTL preference', async function ({page}) {
    // Enable RTL via URL (which also sets the cookie)
    await appendQueryParams(page, {rtl: 'true'});
    let isRtl = await page.locator('#options-rtlcheck').isChecked();
    expect(isRtl).toBe(true);

    // Reload without rtl param — cookie should preserve RTL
    const url = page.url().replace(/[?&]rtl=true/, '');
    await page.goto(url);
    await page.waitForSelector('#editorcontainer.initialized');
    isRtl = await page.locator('#options-rtlcheck').isChecked();
    expect(isRtl).toBe(true);
  });
});
