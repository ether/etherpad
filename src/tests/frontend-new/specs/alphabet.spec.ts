import {expect, Page, test} from "@playwright/test";
import {clearPadContent, getPadBody, getPadOuter, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
  // create a new pad before each test run
  await goToNewPad(page);
})

test.describe('All the alphabet works n stuff', () => {
  const expectedString = 'abcdefghijklmnopqrstuvwxyz';

  test('when you enter any char it appears right', async ({page}) => {
    // get the inner iframe
    const innerFrame =  await getPadBody(page!);

    await innerFrame.click();

    // delete possible old content
    await clearPadContent(page!);

    // writeToPad uses keyboard.insertText which is reliable in Firefox
    // under WITH_PLUGINS load (per-key keyboard.type races and drops
    // characters); see #7625.
    await writeToPad(page, expectedString);
    const text = await innerFrame.locator('div').innerText();
    expect(text).toBe(expectedString);
  });
});
