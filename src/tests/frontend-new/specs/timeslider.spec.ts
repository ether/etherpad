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

  // Issue #8382: colibris's generic checkbox-switch rule also matched the
  // follow toggle's label (it immediately follows the hidden follow
  // checkbox), pushing the eye icon out of its 30px box and under the
  // speed control at normal desktop width.
  test('follow toggle eye icon does not overlap the speed control', async function ({page}) {
    await clearPadContent(page);
    await writeToPad(page, 'Foo');
    await page.waitForTimeout(500);

    const $timesliderButton = page.locator('.buttonicon-history');
    await $timesliderButton.click();
    await expect(page.locator('#history-controls')).toBeVisible();

    const eyeBox = await page.locator('.history-follow-toggle svg').boundingBox();
    const speedBox = await page.locator('.nice-select.history-speed').boundingBox();

    expect(eyeBox).not.toBeNull();
    expect(speedBox).not.toBeNull();
    // No horizontal overlap: the eye icon's right edge must not extend past
    // the speed control's left edge.
    expect(eyeBox!.x + eyeBox!.width).toBeLessThanOrEqual(speedBox!.x + 1);
    // The eye must be vertically centred with the speed control.
    const eyeMid = eyeBox!.y + eyeBox!.height / 2;
    const speedMid = speedBox!.y + speedBox!.height / 2;
    expect(Math.abs(eyeMid - speedMid)).toBeLessThanOrEqual(2);
  });
});
