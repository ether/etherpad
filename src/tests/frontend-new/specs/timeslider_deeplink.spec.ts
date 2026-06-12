import {expect, Page, test} from "@playwright/test";
import {clearPadContent, goToNewPad, writeToPad} from "../helper/padHelper";

// Ported from the "jumps to a revision given in the url" case of the legacy
// timeslider_revisions.js (which no CI workflow ran). Re-targeted at the in-pad
// history model (#7659): a #rev/N hash on the pad URL boots straight into
// history mode at that revision (pad_mode.bootstrapFromHash), and the legacy
// #N shortlink form is still accepted for old bookmarks.
test.describe('timeslider deep link', function () {
  test.describe.configure({mode: 'serial'});

  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  const expectHistoryAtRev0 = async (page: Page) => {
    await expect(page.locator('body.history-mode')).toBeVisible({timeout: 15000});
    await expect(page.locator('#history-controls')).toBeVisible();
    await expect(page.locator('#history-banner-rev')).toHaveText('Version 0', {timeout: 15000});
    await expect.poll(
        async () => await page.locator('#history-slider-input').evaluate(
            (el) => Number((el as HTMLInputElement).value)),
        {timeout: 15000}).toBe(0);
  };

  test('#rev/N hash boots into history mode at that revision', async function ({page}) {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'One ');
    await page.waitForTimeout(400);
    await writeToPad(page, 'Two ');
    await page.waitForTimeout(800);

    // Deep-link to revision 0 of the same pad.
    await page.goto(`http://localhost:9001/p/${padId}#rev/0`);
    await expectHistoryAtRev0(page);
  });

  test('legacy #N shortlink hash still enters history mode', async function ({page}) {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'One ');
    await page.waitForTimeout(400);
    await writeToPad(page, 'Two ');
    await page.waitForTimeout(800);

    await page.goto(`http://localhost:9001/p/${padId}#0`);
    await expectHistoryAtRev0(page);
  });
});
