import {expect, Page, test} from "@playwright/test";
import {clearPadContent, goToNewPad, writeToPad} from "../helper/padHelper";

// Regression coverage for #7946: after #7659 moved the timeslider into the pad
// as an embedded iframe, the user-facing control became the outer
// #history-slider-input range input. Saved revisions ("Save Revision" button)
// are still drawn as stars inside the now-hidden iframe slider, so they
// stopped appearing for users. pad_mode.ts must bridge the saved revisions out
// onto the outer slider as markers.
test.describe('timeslider saved-revision markers', function () {
  test.describe.configure({mode: 'serial'});

  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  const enterHistoryMode = async (page: Page) => {
    await page.click('.buttonicon-history');
    await page.waitForSelector('#history-controls:not([hidden])', {state: 'visible'});
    await page.waitForSelector('#history-frame');
  };

  test('a saved revision shows a marker on the outer history slider', async function ({page}) {
    await goToNewPad(page);
    await clearPadContent(page);

    // Build a few revisions, save one partway through, then add more so the
    // saved marker lands in the middle of the slider (not under the thumb).
    await writeToPad(page, 'One ');
    await page.waitForTimeout(400);
    await writeToPad(page, 'Two ');
    await page.waitForTimeout(600);

    // Save a revision at the current head.
    await page.click('.buttonicon-savedRevision');
    // The save confirmation gritter carries class `saved-revision`.
    await page.waitForSelector('.saved-revision', {state: 'visible'});

    // Add more edits so head advances past the saved revision.
    await writeToPad(page, 'Three ');
    await page.waitForTimeout(400);
    await writeToPad(page, 'Four ');
    await page.waitForTimeout(800);

    await enterHistoryMode(page);

    // The outer slider must show at least one visible saved-revision marker.
    const marker = page.locator('.history-star');
    await expect(marker.first()).toBeVisible({timeout: 15000});
    expect(await marker.count()).toBeGreaterThanOrEqual(1);

    // The marker must be positioned within the slider track, not collapsed to
    // the origin — a degenerate render at left:0 would still be "visible".
    const left = await marker.first().evaluate(
        (el) => parseFloat((el as HTMLElement).style.left) || el.getBoundingClientRect().left);
    expect(left).toBeGreaterThan(0);
  });
});
