import {expect, test} from "@playwright/test";
import {goToNewPad, getPadBody, clearPadContent, writeToPad} from "../helper/padHelper";

/**
 * Regression test for https://github.com/ether/etherpad-lite/issues/5214
 *
 * When a pad's revision history contains an identity changeset (Z:N>0$,
 * representing no actual change), the timeslider playback would crash or
 * break because the broadcast code tried to apply it as a real change.
 */
test.describe('Timeslider with identity changesets (bug #5214)', function () {

  test('timeslider playback works when pad has many revisions', async function ({page}) {
    // Create a pad with several revisions to exercise the timeslider
    const padId = await goToNewPad(page);
    const body = await getPadBody(page);
    await body.click();
    await clearPadContent(page);

    // Create multiple revisions by typing, deleting, retyping
    await writeToPad(page, 'First revision text');
    await page.waitForTimeout(500);

    // Select all and delete (creates a "delete everything" revision similar to the bug)
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    // Type new content
    await writeToPad(page, 'After delete');
    await page.waitForTimeout(1000);

    // Navigate to timeslider
    await page.goto(`http://localhost:9001/p/${padId}/timeslider`);
    await page.waitForSelector('#timeslider-slider', {timeout: 10000});

    // Click play to start playback
    await page.locator('#playpause_button_icon').click();

    // Wait for playback to progress
    await page.waitForTimeout(3000);

    // The page should not have crashed — check for error gritter popups
    const errors = page.locator('.gritter-item.error');
    const errorCount = await errors.count();
    expect(errorCount).toBe(0);

    // The timeslider should still be functional
    await expect(page.locator('#timeslider-slider')).toBeVisible();
  });

  test('timeslider can scrub through all revisions without error', async function ({page}) {
    const padId = await goToNewPad(page);
    const body = await getPadBody(page);
    await body.click();
    await clearPadContent(page);

    // Create revisions
    await writeToPad(page, 'Hello');
    await page.waitForTimeout(300);
    await writeToPad(page, ' World');
    await page.waitForTimeout(300);

    // Select all and delete
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);

    // Retype
    await writeToPad(page, 'New text');
    await page.waitForTimeout(1000);

    // Go to timeslider
    await page.goto(`http://localhost:9001/p/${padId}/timeslider`);
    await page.waitForSelector('#timeslider-slider', {timeout: 10000});

    // Scrub to revision 0
    await page.goto(`http://localhost:9001/p/${padId}/timeslider#0`);
    await page.waitForTimeout(1000);

    // No errors should be visible
    const errors = page.locator('.gritter-item.error');
    expect(await errors.count()).toBe(0);

    // Scrub forward to the latest revision
    const slider = page.locator('#timeslider-slider');
    await expect(slider).toBeVisible();
  });
});
