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

    // The fix ensures handleUserChanges() is called when setIsPendingRevision
    // transitions from true to false after reconnection, so pending changes
    // should be flushed automatically.
    // Verify User 2 receives the offline edit.
    await expect(body2.locator('div').first()).toHaveText('initial text and offline edit');

    await context1.close();
    await context2.close();
  });

  test('bug #5108 regression: handleUserChanges is called when isPendingRevision clears', async function ({page}) {
    // This test verifies the specific codepath: after reconnect, when the server
    // finishes sending CLIENT_RECONNECT messages and setIsPendingRevision(false) is
    // called, handleUserChanges() must be triggered to flush locally-queued edits.
    //
    // The bug was that setChannelState('CONNECTED') fires handleUserChanges() but at
    // that point isPendingRevision is still true, so the changes are not sent. Only
    // after all CLIENT_RECONNECT messages arrive does isPendingRevision become false,
    // and nothing was calling handleUserChanges() at that point.

    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'initial content');

    const body = await getPadBody(page);
    await expect(body.locator('div').first()).toHaveText('initial content');

    // Step 1: Simulate the reconnecting state (as pad.ts socketReconnecting does).
    await page.evaluate(() => {
      const pad = (window as any).pad;
      pad.collabClient.setStateIdle();
      pad.collabClient.setIsPendingRevision(true);
      pad.collabClient.setChannelState('RECONNECTING');
    });

    // Step 2: Type text while in "reconnecting" state (locally queued, not sent).
    await page.keyboard.down('Control');
    await page.keyboard.press('End');
    await page.keyboard.up('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.type('typed during reconnect');

    // Step 3: Simulate reconnect completion.
    // First set CONNECTED (handleUserChanges fires but bails because isPendingRevision is true).
    // Then clear isPendingRevision, which should now trigger handleUserChanges() via the fix.
    await page.evaluate(() => {
      const pad = (window as any).pad;
      pad.collabClient.setChannelState('CONNECTED');
      pad.collabClient.setIsPendingRevision(false);
    });

    // Step 4: Open a second view and verify the locally-typed text was flushed to the server.
    const page2 = await page.context().newPage();
    await goToPad(page2, padId);
    const body2 = await getPadBody(page2);
    await expect(body2.locator('div').nth(1)).toHaveText('typed during reconnect', {timeout: 10000});
  });
});
