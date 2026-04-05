import {clearPadContent, getPadBody, goToNewPad, goToPad, writeToPad} from "../helper/padHelper";
import {expect, test} from "@playwright/test";

test.describe('Pending changeset flush after reconnect', function () {
  test('edits made while disconnected are flushed to server upon reconnection', async function ({browser}) {
    // User 1 creates a pad and types initial text.
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    const padId = await goToNewPad(page1);
    await clearPadContent(page1);
    await writeToPad(page1, 'initial text');

    // Wait for the initial text to be committed to the server by verifying
    // it is visible from a second browser context.
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await goToPad(page2, padId);
    const body2 = await getPadBody(page2);
    await expect(body2.locator('div').first()).toHaveText('initial text');

    // Simulate a network disconnect for User 1 by going offline.
    await page1.context().setOffline(true);

    // Type additional text while disconnected.
    const body1 = await getPadBody(page1);
    await body1.click();
    await page1.keyboard.press('End');
    await page1.keyboard.type(' and offline edit');

    // Verify that User 1 sees the text locally.
    await expect(body1.locator('div').first()).toHaveText('initial text and offline edit');

    // Reconnect User 1 by going back online.
    await page1.context().setOffline(false);

    // The fix ensures handleUserChanges() is called in setUpSocket() after
    // reconnection, so pending changes should be flushed automatically.
    // Verify User 2 receives the offline edit.
    await expect(body2.locator('div').first()).toHaveText('initial text and offline edit');

    await context1.close();
    await context2.close();
  });
});
