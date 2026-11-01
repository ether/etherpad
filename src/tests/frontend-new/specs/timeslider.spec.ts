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

  // Issue #8382: the toolbar's "does everything fit" check
  // (checkAllIconsAreDisplayedInToolbar) only measures the live-mode
  // .menu_left formatting toolbar, which is display:none in history mode, and
  // it only re-runs on a window 'resize' event — never when switching into
  // history mode, and not when a container (e.g. an embedding iframe) is
  // resized without the outer window itself resizing. So whenever
  // #history-controls ends up with less width than its content needs — for
  // example a narrower embed, or any width change that doesn't fire a window
  // resize — nothing re-checks, and the non-shrinking Speed control used to
  // overflow its flex slot and render on top of the Settings/Share/Users/
  // Home icons in .menu_right. Constrain #editbar directly (independent of
  // the outer window size) to reproduce exactly that condition.
  test('playback speed control does not overlap menu_right icons when the toolbar is narrow', async function ({page}) {
    await clearPadContent(page);
    await writeToPad(page, 'Foo');
    await page.waitForTimeout(500);

    const $timesliderButton = page.locator('.buttonicon-history');
    await $timesliderButton.click();
    await expect(page.locator('#history-controls')).toBeVisible();

    await page.addStyleTag({
      content: '#editbar { width: 650px !important; box-sizing: border-box; }',
    });

    const speedBox = await page.locator('.nice-select.history-speed').boundingBox();
    const menuRightBox = await page.locator('.menu_right').boundingBox();

    expect(speedBox).not.toBeNull();
    expect(menuRightBox).not.toBeNull();
    // No horizontal overlap: the speed control's right edge must not extend
    // past menu_right's left edge.
    expect(speedBox!.x + speedBox!.width).toBeLessThanOrEqual(menuRightBox!.x + 1);
  });
});
