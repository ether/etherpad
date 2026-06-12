import {expect, Page, test} from "@playwright/test";
import {clearPadContent, goToNewPad, goToPad, writeToPad} from "../helper/padHelper";

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
    // the origin. Assert on the inline left percentage directly (markers are
    // always positioned via style.left = "N%"); a fallback to a layout-derived
    // coordinate would let a degenerate left:0% render still pass.
    const leftPct = await marker.first().evaluate(
        (el) => parseFloat((el as HTMLElement).style.left));
    expect(leftPct).toBeGreaterThan(0);
    expect(leftPct).toBeLessThan(100);
  });

  test('a revision saved live appears on an already-open history slider', async function ({browser}) {
    // Reviewer (history viewer).
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const padId = await goToNewPad(pageA);
    await clearPadContent(pageA);
    await writeToPad(pageA, 'Alpha Beta ');
    await pageA.waitForTimeout(600);
    await pageA.click('.buttonicon-savedRevision');
    await pageA.waitForSelector('.saved-revision', {state: 'visible'});
    await writeToPad(pageA, 'Gamma Delta ');
    await pageA.waitForTimeout(800);
    await enterHistoryMode(pageA);
    await expect(pageA.locator('.history-star').first()).toBeVisible({timeout: 15000});
    const before = await pageA.locator('.history-star').count();

    // A second collaborator keeps editing the live pad and saves a revision
    // while pageA is sitting in history mode. The server must broadcast
    // NEW_SAVEDREV so pageA's open timeslider gains a marker without reloading.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await goToPad(pageB, padId);
    await writeToPad(pageB, 'Epsilon Zeta Eta ');
    await pageB.waitForTimeout(800);
    await pageB.click('.buttonicon-savedRevision');
    await pageB.waitForSelector('.saved-revision', {state: 'visible'});

    await expect.poll(
        async () => await pageA.locator('.history-star').count(),
        {timeout: 20000})
        .toBeGreaterThan(before);

    await ctxA.close();
    await ctxB.close();
  });
});
