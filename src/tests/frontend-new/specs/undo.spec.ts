'use strict';

import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
    await goToNewPad(page);
})


test.describe('undo button', function () {

    test('undo some typing by clicking undo button', async function ({page}) {
        const padBody = await getPadBody(page);
        await padBody.click()
        await clearPadContent(page)


        // get the first text element inside the editable space
        const firstTextElement = padBody.locator('div').first()
        const originalValue = await firstTextElement.textContent(); // get the original value
        await firstTextElement.focus()

        await writeToPad(page, 'foo'); // send line 1 to the pad

        const modifiedValue = await firstTextElement.textContent(); // get the modified value
        expect(modifiedValue).not.toBe(originalValue); // expect the value to change

        // get clear authorship button as a variable
        const undoButton = page.locator('.buttonicon-undo')
        await undoButton.click() // click the button

        await expect(firstTextElement).toHaveText(originalValue!);
    });

    test('undo some typing using a keypress', async function ({page}) {
        const padBody = await getPadBody(page);
        await padBody.click()
        await clearPadContent(page)

        // get the first text element inside the editable space
        const firstTextElement = padBody.locator('div').first()
        const originalValue = await firstTextElement.textContent(); // get the original value

        await firstTextElement.focus()
        await writeToPad(page, 'foo'); // send line 1 to the pad
        const modifiedValue = await firstTextElement.textContent(); // get the modified value
        expect(modifiedValue).not.toBe(originalValue); // expect the value to change

        // undo the change
        await page.keyboard.press('Control+Z');
        await page.waitForTimeout(1000)

        await expect(firstTextElement).toHaveText(originalValue!);
    });
});
