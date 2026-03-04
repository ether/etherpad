import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
    await goToNewPad(page);
})

test.describe('indentation button', function () {
    test('indent text with keypress', async function ({page}) {
        const padBody = await getPadBody(page);

        // get the first text element out of the inner iframe
        const $firstTextElement = padBody.locator('div').first();

        // select this text element
        await $firstTextElement.selectText()

        await page.keyboard.press('Tab');

        const uls = padBody.locator('div').first().locator('ul li')
        await expect(uls).toHaveCount(1);
    });

    test('indent text with button', async function ({page}) {
        const padBody = await getPadBody(page);
        await page.locator('.buttonicon-indent').click()

        const uls = padBody.locator('div').first().locator('ul')
        await expect(uls).toHaveCount(1);
    });


    test('keeps the indent on enter for the new line', async function ({page}) {
        const padBody = await getPadBody(page);
        await padBody.click()
        await clearPadContent(page)

        await page.locator('.buttonicon-indent').click()

        // type a bit, make a line break and type again
        await padBody.focus()
        await page.keyboard.type('line 1')
        await page.keyboard.press('Enter');
        await page.keyboard.type('line 2')
        await page.keyboard.press('Enter');

        const $newSecondLine = padBody.locator('div span').nth(1)

        const hasULElement = padBody.locator('ul li')

        await expect(hasULElement).toHaveCount(3);
        await expect($newSecondLine).toHaveText('line 2');
    });


    test('indents text with spaces on enter if previous line ends ' +
        "with ':', '[', '(', or '{'", async function ({page}) {
        const padBody = await getPadBody(page);
        await padBody.click()
        await clearPadContent(page)
        // type a bit, make a line break and type again
        const $firstTextElement = padBody.locator('div').first();
        await writeToPad(page, "line with ':'");
        await page.keyboard.press('Enter');
        await writeToPad(page, "line with '['");
        await page.keyboard.press('Enter');
        await writeToPad(page, "line with '('");
        await page.keyboard.press('Enter');
        await writeToPad(page, "line with '{{}'");

        await expect(padBody.locator('div').nth(3)).toHaveText("line with '{{}'");

        // we validate bottom to top for easier implementation


        // curly braces
        const $lineWithCurlyBraces = padBody.locator('div').nth(3)
        await $lineWithCurlyBraces.click();
        await page.keyboard.press('End');
        await page.keyboard.type('{{');

        // cannot use sendkeys('{enter}') here, browser does not read the command properly
        await page.keyboard.press('Enter');

        expect(await padBody.locator('div').nth(4).textContent()).toMatch(/\s{4}/); // tab === 4 spaces



        // parenthesis
        const $lineWithParenthesis = padBody.locator('div').nth(2)
        await $lineWithParenthesis.click();
        await page.keyboard.press('End');
        await page.keyboard.type('(');
        await page.keyboard.press('Enter');
        const $lineAfterParenthesis = padBody.locator('div').nth(3)
        expect(await $lineAfterParenthesis.textContent()).toMatch(/\s{4}/);

        // bracket
        const $lineWithBracket = padBody.locator('div').nth(1)
        await $lineWithBracket.click();
        await page.keyboard.press('End');
        await page.keyboard.type('[');
        await page.keyboard.press('Enter');
        const $lineAfterBracket = padBody.locator('div').nth(2);
        expect(await $lineAfterBracket.textContent()).toMatch(/\s{4}/);

        // colon
        const $lineWithColon = padBody.locator('div').first();
        await $lineWithColon.click();
        await page.keyboard.press('End');
        await page.keyboard.type(':');
        await page.keyboard.press('Enter');
        const $lineAfterColon = padBody.locator('div').nth(1);
        expect(await $lineAfterColon.textContent()).toMatch(/\s{4}/);
    });

    test('appends indentation to the indent of previous line if previous line ends ' +
        "with ':', '[', '(', or '{'", async function ({page}) {
        const padBody = await getPadBody(page);
        await padBody.click()
        await clearPadContent(page)

        // type a bit, make a line break and type again
        await writeToPad(page, "  line with some indentation and ':'")
        await page.keyboard.press('Enter');
        await writeToPad(page, "line 2")

        const $lineWithColon = padBody.locator('div').first();
        await $lineWithColon.click();
        await page.keyboard.press('End');
        await page.keyboard.type(':');
        await page.keyboard.press('Enter');

        const $lineAfterColon = padBody.locator('div').nth(1);
        // previous line indentation + regular tab (4 spaces)
        expect(await $lineAfterColon.textContent()).toMatch(/\s{6}/);
    });

    test("issue #2772 shows '*' when multiple indented lines " +
        ' receive a style and are outdented', async function ({page}) {

        const padBody = await getPadBody(page);
        await padBody.click()
        await clearPadContent(page)

        const inner = padBody.locator('div').first();
        // make sure pad has more than one line
        await inner.click()
        await page.keyboard.type('First');
        await page.keyboard.press('Enter');
        await page.keyboard.type('Second');


        // indent first 2 lines
        await padBody.locator('div').nth(0).selectText();
        await page.locator('.buttonicon-indent').click()

        await padBody.locator('div').nth(1).selectText();
        await page.locator('.buttonicon-indent').click()


        await expect(padBody.locator('ul li')).toHaveCount(2);


        // apply bold
        await padBody.locator('div').nth(0).selectText();
        await page.locator('.buttonicon-bold').click()

        await padBody.locator('div').nth(1).selectText();
        await page.locator('.buttonicon-bold').click()

        await expect(padBody.locator('div b')).toHaveCount(2);

        // outdent first 2 lines
        await padBody.locator('div').nth(0).selectText();
        await page.locator('.buttonicon-outdent').click()

        await padBody.locator('div').nth(1).selectText();
        await page.locator('.buttonicon-outdent').click()

        await expect(padBody.locator('ul li')).toHaveCount(0);

        // check if '*' is displayed
        const secondLine = padBody.locator('div').nth(1);
        await expect(secondLine).toHaveText('Second');
    });

    test('makes text indented and outdented', async function ({page}) {
        // get the inner iframe

        const padBody = await getPadBody(page);

        // get the first text element out of the inner iframe
        let firstTextElement = padBody.locator('div').first();

        // select this text element
        await firstTextElement.selectText()

        // get the indentation button and click it
        await page.locator('.buttonicon-indent').click()

        let newFirstTextElement = padBody.locator('div').first();

        // is there a list-indent class element now?
        await expect(newFirstTextElement.locator('ul')).toHaveCount(1);

        await expect(newFirstTextElement.locator('li')).toHaveCount(1);

        // indent again
        await page.locator('.buttonicon-indent').click()

        newFirstTextElement = padBody.locator('div').first();


        // is there a list-indent class element now?
        const ulList = newFirstTextElement.locator('ul').first()
        await expect(ulList).toHaveCount(1);
        // expect it to be part of a list
        expect(await ulList.getAttribute('class')).toBe('list-indent2');

        // make sure the text hasn't changed
        expect(await newFirstTextElement.textContent()).toBe(await firstTextElement.textContent());


        // test outdent

        // get the unindentation button and click it twice
        newFirstTextElement = padBody.locator('div').first();
        await newFirstTextElement.selectText()
        await page.locator('.buttonicon-outdent').click()
        await page.locator('.buttonicon-outdent').click()

        newFirstTextElement = padBody.locator('div').first();

        // is there a list-indent class element now?
        await expect(newFirstTextElement.locator('ul')).toHaveCount(0);

        // make sure the text hasn't changed
        expect(await newFirstTextElement.textContent()).toEqual(await firstTextElement.textContent());
    });
});
