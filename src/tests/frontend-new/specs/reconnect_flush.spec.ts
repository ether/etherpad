import {clearPadContent, getPadBody, goToNewPad, goToPad, writeToPad} from "../helper/padHelper";
import {expect, test} from "@playwright/test";

test.describe('Pending changeset flush after reconnect', function () {
  test('bug #5108 regression: pending changes flush when isPendingRevision clears', async function ({browser}) {
    // This test verifies the fix: when setIsPendingRevision transitions from
    // true to false after reconnect, handleUserChanges() is called to flush
    // locally-queued edits.

    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    const padId = await goToNewPad(page1);
    await clearPadContent(page1);
    await writeToPad(page1, 'initial content');

    const body1 = await getPadBody(page1);
    await expect(body1.locator('div').first()).toHaveText('initial content', {timeout: 10000});

    // Simulate the reconnecting state (mimics what pad.ts socketReconnecting does)
    await page1.evaluate(() => {
      const pad = (window as any).pad;
      pad.collabClient.setStateIdle();
      pad.collabClient.setIsPendingRevision(true);
      pad.collabClient.setChannelState('RECONNECTING');
    });

    // Type text while in "reconnecting" state — locally queued, not sent to server
    await body1.click();
    await page1.keyboard.press('End');
    await page1.keyboard.press('Enter');
    await page1.keyboard.type('typed during reconnect');

    // Simulate reconnect completion:
    // 1. Set CONNECTED (handleUserChanges fires but bails: isPendingRevision is true)
    // 2. Clear isPendingRevision -> this should trigger handleUserChanges() via the fix
    await page1.evaluate(() => {
      const pad = (window as any).pad;
      pad.collabClient.setChannelState('CONNECTED');
      pad.collabClient.setIsPendingRevision(false);
    });

    // Open a second browser context and verify the locally-typed text was flushed
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await goToPad(page2, padId);
    const body2 = await getPadBody(page2);
    await expect(body2.locator('div').nth(1)).toHaveText('typed during reconnect', {timeout: 15000});

    await context1.close();
    await context2.close();
  });
});
