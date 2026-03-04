import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
    // create a new pad before each test run
    await goToNewPad(page);
})

test.describe('unordered_list.js', function () {
    test.describe('assign unordered list', function () {
        test('insert unordered list text then removes by outdent', async function ({page}) {
            const padBody = await getPadBody(page);
            const originalText = await padBody.locator('div').first().textContent();

            const $insertunorderedlistButton = page.locator('.buttonicon-insertunorderedlist');
            await $insertunorderedlistButton.click();

            await expect(padBody.locator('div').first()).toHaveText(originalText!);
            await expect(padBody.locator('div ul li')).toHaveCount(1);

            // remove indentation by bullet and ensure text string remains the same
            const $outdentButton = page.locator('.buttonicon-outdent');
            await $outdentButton.click();
            await expect(padBody.locator('div').first()).toHaveText(originalText!);
        });
    });

    test.describe('unassign unordered list', function () {
        // create a new pad before each test run


        test('insert unordered list text then remove by clicking list again', async function ({page}) {
            const padBody = await getPadBody(page);
            const originalText = await padBody.locator('div').first().textContent();

            await padBody.locator('div').first().selectText()
            const $insertunorderedlistButton = page.locator('.buttonicon-insertunorderedlist');
            await $insertunorderedlistButton.click();

            await expect(padBody.locator('div').first()).toHaveText(originalText!);
            await expect(padBody.locator('div ul li')).toHaveCount(1);

            // remove indentation by bullet and ensure text string remains the same
            await $insertunorderedlistButton.click();
            await expect(padBody.locator('div').locator('ul')).toHaveCount(0)
        });
    });


    test.describe('keep unordered list on enter key', function () {

        test('Keeps the unordered list on enter for the new line', async function ({page}) {
            const padBody = await getPadBody(page);
            await clearPadContent(page)
            await expect(padBody.locator('div')).toHaveCount(1)

            const $insertorderedlistButton = page.locator('.buttonicon-insertunorderedlist')
            await $insertorderedlistButton.click();

            // type a bit, make a line break and type again
            const $firstTextElement = padBody.locator('div').first();
            await $firstTextElement.click()
            await page.keyboard.type('line 1');
            await page.keyboard.press('Enter');
            await page.keyboard.type('line 2');
            await page.keyboard.press('Enter');

            await expect(padBody.locator('div span')).toHaveCount(2);


            const $newSecondLine = padBody.locator('div').nth(1)
            await expect($newSecondLine.locator('ul')).toHaveCount(1);
            await expect($newSecondLine).toHaveText('line 2');
        });
    });

    test.describe('Pressing Tab in an UL increases and decreases indentation', function () {

        test('indent and de-indent list item with keypress', async function ({page}) {
            const padBody = await getPadBody(page);
            await clearPadContent(page)

            // get the first text element out of the inner iframe
            const $firstTextElement = padBody.locator('div').first();

            // select this text element
            await $firstTextElement.selectText();

            const $insertunorderedlistButton = page.locator('.buttonicon-insertunorderedlist');
            await $insertunorderedlistButton.click();

            await padBody.locator('div').first().click();
            await page.keyboard.press('Home');
            await page.keyboard.press('Tab');
            await expect(padBody.locator('div').first().locator('.list-bullet2')).toHaveCount(1);

            await page.keyboard.press('Shift+Tab');

            await expect(padBody.locator('div').first().locator('.list-bullet1')).toHaveCount(1);
        });
    });

    test.describe('Pressing indent/outdent button in an UL increases and decreases indentation ' +
        'and bullet / ol formatting', function () {

        test('indent and de-indent list item with indent button', async function ({page}) {
            const padBody = await getPadBody(page);

            // get the first text element out of the inner iframe
            const $firstTextElement = padBody.locator('div').first();

            // select this text element
            await $firstTextElement.selectText();

            const $insertunorderedlistButton = page.locator('.buttonicon-insertunorderedlist');
            await $insertunorderedlistButton.click();

            await page.locator('.buttonicon-indent').click();

            await expect(padBody.locator('div').first().locator('.list-bullet2')).toHaveCount(1);
            const outdentButton = page.locator('.buttonicon-outdent');
            await outdentButton.click();

            await expect(padBody.locator('div').first().locator('.list-bullet1')).toHaveCount(1);
        });
    });
});
