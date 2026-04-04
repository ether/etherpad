import {expect, test} from "@playwright/test";
import {goToNewPad, getPadBody, clearPadContent, writeToPad} from "../helper/padHelper";

/**
 * Regression test for https://github.com/ether/etherpad-lite/issues/5214
 *
 * When a pad's revision history contains an identity changeset (Z:N>0$,
 * representing no actual change), the timeslider playback would crash or
 * break because the broadcast code tried to apply it as a real change.
 *
 * Identity changesets appear when compose() of multiple revisions produces
 * a net-zero change (e.g., type "hello" then delete "hello").
 */
test.describe('Timeslider with identity changesets (bug #5214)', function () {

  test('timeslider playback advances through all revisions including identity changesets', async function ({page}) {
    // Create a pad with several revisions to exercise the timeslider
    const padId = await goToNewPad(page);
    const body = await getPadBody(page);
    await body.click();
    await clearPadContent(page);

    // Create multiple revisions by typing, deleting, retyping.
    // When compose() composes the delete+retype, it can produce an identity changeset.
    await writeToPad(page, 'First revision text');
    await page.waitForTimeout(500);

    // Select all and delete (creates a "delete everything" revision)
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    // Type new content (combined with delete above, compose can yield identity)
    await writeToPad(page, 'After delete');
    await page.waitForTimeout(1000);

    // Navigate to timeslider
    await page.goto(`http://localhost:9001/p/${padId}/timeslider`);
    await page.waitForSelector('#timeslider-slider', {timeout: 10000});

    // Record the initial slider position
    const sliderBefore = await page.locator('#ui-slider-handle').getAttribute('style');

    // Click play to start playback
    await page.locator('#playpause_button_icon').click();

    // Wait for playback to progress through revisions
    await page.waitForTimeout(3000);

    // The slider should have advanced from its initial position
    const sliderAfter = await page.locator('#ui-slider-handle').getAttribute('style');
    expect(sliderAfter).not.toBe(sliderBefore);

    // The page should not have crashed — check for error gritter popups
    const errors = page.locator('.gritter-item.error');
    expect(await errors.count()).toBe(0);

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

    // Get the total number of revisions from the slider
    const sliderLength = await page.evaluate(() => {
      return (window as any).BroadcastSlider?.getSliderLength?.() ?? 0;
    });

    // Scrub through each revision from 0 to latest
    for (let rev = 0; rev <= sliderLength; rev++) {
      await page.goto(`http://localhost:9001/p/${padId}/timeslider#${rev}`);
      await page.waitForTimeout(300);

      // Check no errors appeared
      const errors = page.locator('.gritter-item.error');
      expect(await errors.count()).toBe(0);
    }

    // Final check: timeslider is still functional
    await expect(page.locator('#timeslider-slider')).toBeVisible();
  });
});
