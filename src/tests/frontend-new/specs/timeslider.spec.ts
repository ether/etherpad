import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
  // create a new pad before each test run
  await goToNewPad(page);
})


// Issue #7659: clicking the history toolbar button enters history mode
// in-place. The pad URL stays the same; only the hash changes to #rev/...
test.describe('history toolbar button enters in-pad history mode', function () {

  test('history mode mounts iframe and sets #rev/ hash', async function ({page}) {
    const padBody = await getPadBody(page);
    await clearPadContent(page)
    await writeToPad(page, 'Foo');

    const $firstTextElement = padBody.locator('div span').first();
    const originalValue = await $firstTextElement.textContent();
    await $firstTextElement.click()
    await writeToPad(page, 'Testing');

    const modifiedValue = await $firstTextElement.textContent();
    expect(modifiedValue).not.toBe(originalValue);

    const $timesliderButton = page.locator('.buttonicon-history');
    await $timesliderButton.click();

    // Banner appears, body gets the history-mode class, hash is #rev/...
    await expect(page.locator('#history-banner')).toBeVisible();
    await expect(page.locator('body.history-mode')).toBeVisible();
    expect(page.url()).toMatch(/#rev\//);
    // The pad URL itself never changes to /timeslider — that route is
    // reserved for the embedded iframe.
    expect(new URL(page.url()).pathname).not.toContain('timeslider');

    // The iframe is mounted and the outer history-controls (slider, play,
    // step buttons) take over the toolbar's left zone.
    await expect(page.locator('#history-controls')).toBeVisible();
    await expect(page.locator('#history-slider-input')).toBeVisible();
    await expect(page.locator('#history-playpause')).toBeVisible();
  });
});
