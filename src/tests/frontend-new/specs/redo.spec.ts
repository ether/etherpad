import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
    await goToNewPad(page);
})


test.describe('undo button then redo button', function () {


    test('redo some typing with button', async function ({page}) {
        const padBody = await getPadBody(page);

        // get the first text element inside the editable space
        const $firstTextElement = padBody.locator('div span').first();
        const originalValue = await $firstTextElement.textContent(); // get the original value
        const newString = 'Foo';

        await $firstTextElement.focus()
        expect(await $firstTextElement.textContent()).toContain(originalValue);
        await padBody.click()
        await clearPadContent(page)
        await writeToPad(page, newString); // send line 1 to the pad

        const modifiedValue = await $firstTextElement.textContent(); // get the modified value
        expect(modifiedValue).not.toBe(originalValue); // expect the value to change

        // get undo and redo buttons // click the buttons
        await page.locator('.buttonicon-undo').click() // removes foo
        await page.locator('.buttonicon-redo').click() // resends foo

        await expect($firstTextElement).toHaveText(newString);

        const finalValue = await padBody.locator('div').first().textContent();
        expect(finalValue).toBe(modifiedValue); // expect the value to change
    });

    test('redo some typing with keypress', async function ({page}) {
        const padBody = await getPadBody(page);

        // get the first text element inside the editable space
        const $firstTextElement = padBody.locator('div span').first();
        const originalValue = await $firstTextElement.textContent(); // get the original value
        const newString = 'Foo';

        await padBody.click()
        await clearPadContent(page)
        await writeToPad(page, newString); // send line 1 to the pad
        const modifiedValue = await $firstTextElement.textContent(); // get the modified value
        expect(modifiedValue).not.toBe(originalValue); // expect the value to change

        // undo the change
        await padBody.click()
        await page.keyboard.press('Control+Z');

        await page.keyboard.press('Control+Y'); // redo the change


        await expect($firstTextElement).toHaveText(newString);

        const finalValue = await padBody.locator('div').first().textContent();
        expect(finalValue).toBe(modifiedValue); // expect the value to change
    });
});
