import {clearPadContent, getPadBody, goToNewPad, goToPad, writeToPad} from "../helper/padHelper";
import {expect, Page, test} from "@playwright/test";

let padId = "";

test.beforeEach(async ({ page })=>{
    // create a new pad before each test run
    padId = await goToNewPad(page);
    const body = await getPadBody(page);
    await body.click();
    await clearPadContent(page);
    await writeToPad(page, "Hello World");
    await page.keyboard.press('Enter');
    await writeToPad(page, "Hello World");
    await page.keyboard.press('Enter');
    await writeToPad(page, "Hello World");
    await page.keyboard.press('Enter');
    await writeToPad(page, "Hello World");
    await page.keyboard.press('Enter');
    await writeToPad(page, "Hello World");
    await page.keyboard.press('Enter');
})

test.describe('Messages in the COLLABROOM', function () {
    const user1Text = 'text created by user 1';
    const user2Text = 'text created by user 2';

    const replaceLineText = async (lineNumber: number, newText: string, page: Page) => {
        const body = await getPadBody(page)

        const div = body.locator('div').nth(lineNumber)

        // simulate key presses to delete content
        await div.locator('span').selectText() // select all
        await page.keyboard.press('Backspace') // clear the first line
        await page.keyboard.type(newText) // insert the string
    };

    test('bug #4978 regression test', async function ({browser}) {
        // The bug was triggered by receiving a change from another user while simultaneously composing
        // a character and waiting for an acknowledgement of a previously sent change.

        // User 1
        const context1 = await browser.newContext();
        const page1 = await context1.newPage();
        await goToPad(page1, padId)
        const body1 = await getPadBody(page1)
        // Perform actions as User 1...

        // User 2
        const context2 = await browser.newContext();
        const page2 = await context2.newPage();
        await goToPad(page2, padId)
        const body2 = await getPadBody(page1)

        await replaceLineText(0, user1Text,page1);

        const text = await body2.locator('div').nth(0).textContent()
        const res =  text === user1Text
        expect(res).toBe(true)

            // User 1 starts a character composition.


        await replaceLineText(1, user2Text, page2)

        await expect(body1.locator('div').nth(1)).toHaveText(user2Text)


        // Users 1 and 2 make some more changes.
        await replaceLineText(3, user2Text, page2);

        await expect(body1.locator('div').nth(3)).toHaveText(user2Text)

        await replaceLineText(2, user1Text, page1);
        await expect(body2.locator('div').nth(2)).toHaveText(user1Text)

        // All changes should appear in both views.
        const expectedLines = [
            user1Text,
            user2Text,
            user1Text,
            user2Text,
        ];

        for (let i=0;i<expectedLines.length;i++){
            expect(await body1.locator('div').nth(i).textContent()).toBe(expectedLines[i]);
        }

        for (let i=0;i<expectedLines.length;i++){
            expect(await body2.locator('div').nth(i).textContent()).toBe(expectedLines[i]);
        }
    });
});
