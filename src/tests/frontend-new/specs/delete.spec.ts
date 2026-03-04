import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
    // create a new pad before each test run
    await goToNewPad(page);
})


test('delete keystroke', async ({page}) => {
    const padText = "Hello World this is a test"
    const body = await getPadBody(page)
    await body.click()
    await clearPadContent(page)
    await page.keyboard.type(padText)
    // Navigate to the end of the text
    await page.keyboard.press('End');
    // Delete the last character
    await page.keyboard.press('Backspace');
    const text = await body.locator('div').innerText();
    expect(text).toBe(padText.slice(0, -1));
})
