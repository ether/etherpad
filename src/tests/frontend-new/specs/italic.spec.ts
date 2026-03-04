import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
    await goToNewPad(page);
})

test.describe('italic some text', function () {

    test('makes text italic using button', async function ({page}) {
        const padBody = await getPadBody(page);
        await padBody.click()
        await clearPadContent(page)

        // get the first text element out of the inner iframe
        const $firstTextElement = padBody.locator('div').first();
        await $firstTextElement.click()
        await writeToPad(page, 'Foo')

        // select this text element
        await padBody.click()
        await page.keyboard.press('Control+A');

        // get the bold button and click it
        const $boldButton = page.locator('.buttonicon-italic');
        await $boldButton.click();

        // ace creates a new dom element when you press a button, just get the first text element again
        const $newFirstTextElement = padBody.locator('div').first();

        // is there a <i> element now?
        // expect it to be italic
        await expect($newFirstTextElement.locator('i')).toHaveCount(1);


        // make sure the text hasn't changed
        expect(await $newFirstTextElement.textContent()).toEqual(await $firstTextElement.textContent());
    });

    test('makes text italic using keypress', async function ({page}) {
        const padBody = await getPadBody(page);
        await padBody.click()
        await clearPadContent(page)

        // get the first text element out of the inner iframe
        const $firstTextElement = padBody.locator('div').first();

        // select this text element
        await writeToPad(page, 'Foo')

        await page.keyboard.press('Control+A');

        await page.keyboard.press('Control+I');

        // ace creates a new dom element when you press a button, just get the first text element again
        const $newFirstTextElement = padBody.locator('div').first();

        // is there a <i> element now?
        // expect it to be italic
        await expect($newFirstTextElement.locator('i')).toHaveCount(1);

        // make sure the text hasn't changed
        expect(await $newFirstTextElement.textContent()).toBe(await $firstTextElement.textContent());
    });
});
