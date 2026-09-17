import {expect, test, Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {goToNewPad, goToPad} from '../helper/padHelper';
import {showSettings} from '../helper/settingsHelper';

// Issue #8201: after deleting a pad, the welcome screen kept listing it under
// "Recent pads" because the entry in localStorage was never removed.

const recentPadNames = async (page: Page): Promise<string[]> => page.evaluate(
    () => JSON.parse(window.localStorage.getItem('recentPads') || '[]')
        .map((p: {name: string}) => p.name));

const waitForHome = async (page: Page) => page.waitForURL(
    (url) => url.pathname === '/' || url.pathname.endsWith('/index.html'), {timeout: 10000});

test.describe('recent pads after pad deletion', () => {
  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  test('creator deleting a pad removes it from the welcome screen', async ({page}) => {
    const padId = await goToNewPad(page);
    expect(await recentPadNames(page)).toContain(padId);

    await showSettings(page);
    page.once('dialog', (d) => d.accept());
    await page.locator('#delete-pad').click();
    await waitForHome(page);

    expect(await recentPadNames(page)).not.toContain(padId);
    await expect(page.locator('.recent-pad a', {hasText: padId})).toHaveCount(0);
  });

  test('deleting with a token on a second device removes it from that device', async ({
    page, browser,
  }) => {
    const padId = `FRONTEND_TESTS${randomUUID()}`;
    await page.goto(`http://localhost:9001/p/${padId}`);
    await page.waitForSelector('#editorcontainer.initialized');
    const token = await page.locator('#deletiontoken-value').inputValue();
    await page.locator('#deletiontoken-ack').click();

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await goToPad(page2, padId);
    expect(await recentPadNames(page2)).toContain(padId);

    await showSettings(page2);
    await page2.locator('#delete-pad-with-token > summary').click();
    await page2.locator('#delete-pad-token-input').fill(token);
    page2.once('dialog', (d) => d.accept());
    await page2.locator('#delete-pad-token-submit').click();
    await waitForHome(page2);

    expect(await recentPadNames(page2)).not.toContain(padId);
    await expect(page2.locator('.recent-pad a', {hasText: padId})).toHaveCount(0);
    // The creator's still-open tab was disconnected with reason "deleted" and
    // must also forget the pad.
    await expect.poll(() => recentPadNames(page)).not.toContain(padId);

    await context2.close();
  });
});
