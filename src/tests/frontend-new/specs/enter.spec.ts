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
        const padBody = await getPadBody(page);
        const originalLength = await padBody.locator('div').count();
        let lastLine = padBody.locator('div').last();

        // simulate key presses to enter content
        let i = 0;
        const numberOfLines = 15;
        while (i < numberOfLines) {
            lastLine = padBody.locator('div').last();
            await lastLine.focus();
            await page.keyboard.press('End');
            await page.keyboard.press('Enter');

            // check we can see the caret..
            i++;
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
