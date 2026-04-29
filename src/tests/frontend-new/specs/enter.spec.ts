'use strict';
import {expect, test} from "@playwright/test";
import {getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
  await goToNewPad(page);
})

test.describe('enter keystroke', function () {

  test('creates a new line & puts cursor onto a new line', async function ({page}) {
    const padBody = await getPadBody(page);

    // get the first text element out of the inner iframe
    const firstTextElement = padBody.locator('div').nth(0)

    // get the original string value minus the last char
    const originalTextValue = await firstTextElement.textContent();

    // simulate key presses to enter content
    await firstTextElement.click()
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');

    const updatedFirstElement = padBody.locator('div').nth(0)
    expect(await updatedFirstElement.textContent()).toBe('')

    const newSecondLine = padBody.locator('div').nth(1);
    // expect the second line to be the same as the original first line.
    expect(await newSecondLine.textContent()).toBe(originalTextValue);
  });

  test('enter is always visible after event', async function ({page}) {
    // Even with the per-iteration toHaveCount value-wait, this 15-Enter
    // loop occasionally misses a line under WITH_PLUGINS load when the
    // editor's input pipeline backs up and a press is silently dropped.
    // Tracked by #7611 — needs a different drive mechanism (REST API
    // or single multi-line write) to un-skip reliably.
    test.skip(process.env.WITH_PLUGINS === '1', 'flaky in with-plugins suite — see #7611');
    const padBody = await getPadBody(page);
    const originalLength = await padBody.locator('div').count();

    // Press Enter `numberOfLines` times. Each iteration value-waits
    // for the line count to advance before issuing the next press —
    // a tight Enter-loop with no per-iteration verify dropped events
    // under Firefox + WITH_PLUGINS load (the editor's input pipeline
    // can't always keep up with back-to-back keypresses while plugin
    // hooks are warming).
    const numberOfLines = 15;
    for (let i = 0; i < numberOfLines; i++) {
      const expectedCount = originalLength + i + 1;
      const lastLine = padBody.locator('div').last();
      await lastLine.focus();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await expect(padBody.locator('div')).toHaveCount(expectedCount);
    }

    expect(await padBody.locator('div').count()).toBe(numberOfLines + originalLength);

    // is edited line fully visible?
    const lastDiv = padBody.locator('div').last()
    const lastDivOffset = await lastDiv.boundingBox();
    const bottomOfLastLine = lastDivOffset!.y + lastDivOffset!.height;
    const scrolledWindow = page.frames()[0];
    const windowOffset = await scrolledWindow.evaluate(() => window.pageYOffset);
    const windowHeight = await scrolledWindow.evaluate(() => window.innerHeight);

    expect(windowOffset + windowHeight).toBeGreaterThan(bottomOfLastLine);
  });
});
