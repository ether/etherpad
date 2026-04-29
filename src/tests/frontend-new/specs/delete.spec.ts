import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
  // create a new pad before each test run
  await goToNewPad(page);
})


test('delete keystroke', async ({page}) => {
  const padText = "Hello World this is a test"
  const body = await getPadBody(page)
  await body.click()
  await clearPadContent(page)
  // writeToPad uses keyboard.insertText (single input event); per-key
  // keyboard.type races and drops characters in Firefox under
  // WITH_PLUGINS load — see #7625.
  await writeToPad(page, padText)
  // Navigate to the end of the text
  await page.keyboard.press('End');
  // Delete the last character
  await page.keyboard.press('Backspace');
  const text = await body.locator('div').innerText();
  expect(text).toBe(padText.slice(0, -1));
})
