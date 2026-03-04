import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
  await goToNewPad(page);
})


test.describe('ordered_list.js', function () {

    test('issue #4748 keeps numbers increment on OL', async function ({page}) {
      const padBody = await getPadBody(page);
      await clearPadContent(page)
      await writeToPad(page, 'Line 1')
      await page.keyboard.press('Enter')
      await writeToPad(page, 'Line 2')

      const $insertorderedlistButton = page.locator('.buttonicon-insertorderedlist')
      await padBody.locator('div').first().selectText()
      await $insertorderedlistButton.first().click();

      const secondLine = padBody.locator('div').nth(1)

      await secondLine.selectText()
      await $insertorderedlistButton.click();

      expect(await secondLine.locator('ol').getAttribute('start')).toEqual('2');
    });

    test('issue #1125 keeps the numbered list on enter for the new line', async function ({page}) {
      // EMULATES PASTING INTO A PAD
      const padBody = await getPadBody(page);
      await clearPadContent(page)
      await expect(padBody.locator('div')).toHaveCount(1)
      const $insertorderedlistButton = page.locator('.buttonicon-insertorderedlist')
      await $insertorderedlistButton.click();

      // type a bit, make a line break and type again
      const firstTextElement = padBody.locator('div').first()
      await firstTextElement.click()
      await writeToPad(page, 'line 1')
      await page.keyboard.press('Enter')
      await writeToPad(page, 'line 2')
      await page.keyboard.press('Enter')

      await expect(padBody.locator('div span').nth(1)).toHaveText('line 2');

        const $newSecondLine = padBody.locator('div').nth(1)
      expect(await $newSecondLine.locator('ol li').count()).toEqual(1);
        await expect($newSecondLine.locator('ol li').nth(0)).toHaveText('line 2');
        const hasLineNumber = await $newSecondLine.locator('ol').getAttribute('start');
      // This doesn't work because pasting in content doesn't work
      expect(Number(hasLineNumber)).toBe(2);
    });
  });

  test.describe('Pressing Tab in an OL increases and decreases indentation', function () {

    test('indent and de-indent list item with keypress', async function ({page}) {
      const padBody = await getPadBody(page);

      // get the first text element out of the inner iframe
      const $firstTextElement = padBody.locator('div').first();

      // select this text element
      await $firstTextElement.selectText()

      const $insertorderedlistButton = page.locator('.buttonicon-insertorderedlist')
      await $insertorderedlistButton.click()

      await page.keyboard.press('Tab')

      await expect(padBody.locator('div').first().locator('.list-number2')).toHaveCount(1)

      await page.keyboard.press('Shift+Tab')


      await expect(padBody.locator('div').first().locator('.list-number1')).toHaveCount(1)
    });
  });


  test.describe('Pressing indent/outdent button in an OL increases and ' +
      'decreases indentation and bullet / ol formatting', function () {

    test('indent and de-indent list item with indent button', async function ({page}) {
      const padBody = await getPadBody(page);

      // get the first text element out of the inner iframe
      const $firstTextElement = padBody.locator('div').first();

      // select this text element
      await $firstTextElement.selectText()

      const $insertorderedlistButton = page.locator('.buttonicon-insertorderedlist')
      await $insertorderedlistButton.click()

      const $indentButton = page.locator('.buttonicon-indent')
      await $indentButton.dblclick() // make it indented twice

      const outdentButton = page.locator('.buttonicon-outdent')

      await expect(padBody.locator('div').first().locator('.list-number3')).toHaveCount(1)

      await outdentButton.click(); // make it deindented to 1

      await expect(padBody.locator('div').first().locator('.list-number2')).toHaveCount(1)
    });
  });
