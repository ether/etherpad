import {expect, test} from '@playwright/test';
import {goToNewPad, goToPad} from '../helper/padHelper';
import {showSettings} from '../helper/settingsHelper';

test.describe('pad deletion token', () => {
  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  test('creator sees a token modal exactly once and can dismiss it', async ({page}) => {
    await goToNewPad(page);
    const modal = page.locator('#deletiontoken-modal');
    await expect(modal).toBeVisible();

    const tokenValue = await page.locator('#deletiontoken-value').inputValue();
    expect(tokenValue.length).toBeGreaterThanOrEqual(32);

    await page.locator('#deletiontoken-ack').click();
    await expect(modal).toBeHidden();

    const cleared = await page.evaluate(
        () => (window as any).clientVars.padDeletionToken);
    expect(cleared == null).toBe(true);
  });

  test('second device can delete using the captured token', async ({page, browser}) => {
    const padId = await goToNewPad(page);
    const token = await page.locator('#deletiontoken-value').inputValue();
    await page.locator('#deletiontoken-ack').click();

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await goToPad(page2, padId);
    await showSettings(page2);

    await page2.locator('#delete-pad-with-token > summary').click();
    await page2.locator('#delete-pad-token-input').fill(token);
    page2.once('dialog', (d) => d.accept());
    await page2.locator('#delete-pad-token-submit').click();

    await page2.waitForURL((url) => url.pathname === '/' || url.pathname.endsWith('/index.html'),
        {timeout: 10000});

    await context2.close();
  });

  test('wrong token keeps the pad alive and surfaces a shout', async ({page, browser}) => {
    const padId = await goToNewPad(page);
    await page.locator('#deletiontoken-ack').click();

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await goToPad(page2, padId);
    await showSettings(page2);

    await page2.locator('#delete-pad-with-token > summary').click();
    await page2.locator('#delete-pad-token-input').fill('bogus-token-value');
    // Accept the confirm() dialog, then capture the alert() the shout triggers.
    const dialogs: string[] = [];
    page2.on('dialog', async (d) => {
      dialogs.push(d.message());
      await d.accept();
    });
    await page2.locator('#delete-pad-token-submit').click();

    await expect.poll(() => dialogs.length, {timeout: 10000}).toBeGreaterThanOrEqual(2);
    expect(dialogs.some((m) => /not the creator|cannot delete/i.test(m))).toBe(true);

    // Pad must still exist for the original creator.
    await page.reload();
    await expect(page.locator('#editorcontainer.initialized')).toBeVisible();
    await context2.close();
  });
});
