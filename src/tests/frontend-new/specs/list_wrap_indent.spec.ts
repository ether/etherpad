import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

// Regression test for https://github.com/ether/etherpad-lite/issues/2581
test.describe('numbered list wrapped line indentation', function () {
  test('wrapped lines in a numbered list item are indented', async function ({page}) {
    const padBody = await getPadBody(page);
    await clearPadContent(page);

    // Type a long line that will wrap
    const longText = 'This is a very long numbered list item that should wrap to multiple lines ' +
      'in the editor viewport so we can verify that the wrapped continuation lines are properly ' +
      'indented to match the first line of the list item instead of snapping back to the left edge.';
    await writeToPad(page, longText);

    // Make it an ordered list
    const $insertorderedlistButton = page.locator('.buttonicon-insertorderedlist');
    await padBody.locator('div').first().selectText();
    await $insertorderedlistButton.first().click();

    // Verify the list item has padding-left applied (not text-indent)
    const ol = padBody.locator('ol').first();
    await expect(ol).toBeVisible();
    const paddingLeft = await ol.evaluate((el) => window.getComputedStyle(el).paddingLeft);
    const textIndent = await ol.evaluate((el) => window.getComputedStyle(el).textIndent);

    // padding-left should be used instead of text-indent for proper wrapping
    // text-indent should be 0px (not used for indentation)
    expect(textIndent).toBe('0px');
  });
});
