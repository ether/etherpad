import {expect, test} from '@playwright/test';
import {clearPadContent, goToNewPad, writeToPad} from '../helper/padHelper';

// Issue #7659 — in-pad history mode.
//
// The pad and timeslider used to be on different URLs. Clicking the history
// toolbar button now keeps the user on the same URL and toggles a hash-based
// state instead. This spec exercises the entry, exit, direct-load, and
// browser-back paths, and asserts the rendered (localized) banner string
// rather than just element presence.

test.describe('in-pad history mode', () => {
  test('toolbar button enters history without leaving the pad URL', async ({page}) => {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'Hello');
    await page.waitForTimeout(500);
    await writeToPad(page, ' world');
    await page.waitForTimeout(500);

    const padPath = new URL(page.url()).pathname;

    await page.locator('.buttonicon-history').click();

    await expect(page.locator('body.history-mode')).toBeVisible();
    const banner = page.locator('#history-banner');
    await expect(banner).toBeVisible();

    // Banner is localized — assert the rendered string, not just presence.
    await expect(banner.locator('.history-banner-label'))
        .toHaveText('Viewing history');
    await expect(banner.locator('#history-banner-return'))
        .toHaveText('Return to live');

    // Pathname unchanged; only the hash is added.
    expect(new URL(page.url()).pathname).toBe(padPath);
    expect(page.url()).toMatch(/#rev\//);

    // The iframe mounted with the embedded timeslider markup.
    const frame = page.frameLocator('#history-frame');
    await expect(frame.locator('#timeslider-wrapper')).toBeVisible();
    await expect(frame.locator('body.embedded-history-frame')).toBeVisible();
    expect(padId).toBeTruthy();
  });

  test('Return-to-live exits history and clears the hash', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'A');
    await page.waitForTimeout(300);
    await writeToPad(page, 'B');
    await page.waitForTimeout(300);

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();

    await page.locator('#history-banner-return').click();
    await expect(page.locator('body.history-mode')).toHaveCount(0);
    await expect(page.locator('#history-banner')).toBeHidden();
    expect(new URL(page.url()).hash).toBe('');
  });

  test('browser back exits history mode', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'X');
    await page.waitForTimeout(300);

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();

    await page.goBack();
    await expect(page.locator('body.history-mode')).toHaveCount(0);
    await expect(page.locator('#history-banner')).toBeHidden();
  });

  test('legacy /p/:pad/timeslider URL redirects to the pad page', async ({page}) => {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'Y');
    await page.waitForTimeout(300);

    const res = await page.goto(`http://localhost:9001/p/${padId}/timeslider`);
    // Final landing URL is the pad page, not /timeslider.
    expect(new URL(page.url()).pathname).toBe(`/p/${padId}`);
    expect(res?.status()).toBe(200);
  });
});
