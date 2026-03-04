import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
    await goToNewPad(page);
})

test.describe('strikethrough button', function () {

    test('makes text strikethrough', async function ({page}) {
        const padBody = await getPadBody(page);

        // get the first text element out of the inner iframe
        const $firstTextElement = padBody.locator('div').first();

        // select this text element
        await $firstTextElement.selectText()

        // get the strikethrough button and click it
        await page.locator('.buttonicon-strikethrough').click();

        // ace creates a new dom element when you press a button, just get the first text element again

        // is there a <i> element now?
        await expect($firstTextElement.locator('s')).toHaveCount(1);

        // make sure the text hasn't changed
        expect(await $firstTextElement.textContent()).toEqual(await $firstTextElement.textContent());
    });
});
