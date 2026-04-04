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

  // Regression test for https://github.com/ether/etherpad-lite/issues/5160
  test('issue #5160 ordered list increments correctly after unordered list', async function ({page}) {
    const padBody = await getPadBody(page);
    await clearPadContent(page);

    // Create two unordered list items
    const $insertUnorderedButton = page.locator('.buttonicon-insertunorderedlist');
    await $insertUnorderedButton.click({force: true});
    await writeToPad(page, 'bullet a');
    await page.keyboard.press('Enter');
    await writeToPad(page, 'bullet b');
    await page.keyboard.press('Enter');

    // Now switch to ordered list for the next items
    const $insertOrderedButton = page.locator('.buttonicon-insertorderedlist');
    await $insertOrderedButton.click({force: true});
    await writeToPad(page, 'number 1');
    await page.keyboard.press('Enter');
    await writeToPad(page, 'number 2');
    await page.keyboard.press('Enter');
    await writeToPad(page, 'number 3');

    // Wait for renumbering
    await page.waitForTimeout(500);

    // The first ordered list item (line 3) should have start=1
    const thirdLine = padBody.locator('div').nth(2);
    await expect(thirdLine.locator('ol')).toHaveAttribute('start', '1', {timeout: 5000});

    // The second ordered list item (line 4) should have start=2
    const fourthLine = padBody.locator('div').nth(3);
    await expect(fourthLine.locator('ol')).toHaveAttribute('start', '2', {timeout: 5000});

    // The third ordered list item (line 5) should have start=3
    const fifthLine = padBody.locator('div').nth(4);
    await expect(fifthLine.locator('ol')).toHaveAttribute('start', '3', {timeout: 5000});
  });

  // Regression test for https://github.com/ether/etherpad-lite/issues/5718
  test('issue #5718 consecutive numbering works after indented sub-bullets', async function ({page}) {
    const padBody = await getPadBody(page);
    await clearPadContent(page);

    // Create a bullet point
    const $insertUnorderedButton = page.locator('.buttonicon-insertunorderedlist');
    await $insertUnorderedButton.click({force: true});
    await writeToPad(page, 'Bullet item');
    await page.keyboard.press('Enter');

    // Indent to create a sub-bullet
    await page.keyboard.press('Tab');
    await writeToPad(page, 'Sub-bullet');

    // Verify the sub-bullet is actually indented (level 2)
    const subBulletLine = padBody.locator('div').nth(1);
    await expect(subBulletLine.locator('.list-bullet2')).toHaveCount(1, {timeout: 5000});

    await page.keyboard.press('Enter');

    // De-indent back to level 1
    await page.keyboard.press('Shift+Tab');

    // Switch to numbered list
    const $insertOrderedButton = page.locator('.buttonicon-insertorderedlist');
    await $insertOrderedButton.click({force: true});
    await writeToPad(page, 'Number 1');
    await page.keyboard.press('Enter');
    await writeToPad(page, 'Number 2');
    await page.keyboard.press('Enter');
    await writeToPad(page, 'Number 3');

    // Lines 3, 4, 5 should be numbered 1, 2, 3
    const line3 = padBody.locator('div').nth(2);
    await expect(line3.locator('ol')).toHaveAttribute('start', '1', {timeout: 5000});

    const line4 = padBody.locator('div').nth(3);
    await expect(line4.locator('ol')).toHaveAttribute('start', '2', {timeout: 5000});

    const line5 = padBody.locator('div').nth(4);
    await expect(line5.locator('ol')).toHaveAttribute('start', '3', {timeout: 5000});
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
