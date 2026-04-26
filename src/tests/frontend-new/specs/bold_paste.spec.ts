import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, selectAllText, writeToPad} from "../helper/padHelper.js";

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

// Regression test for https://github.com/ether/etherpad-lite/issues/5037
test('bold text retains formatting after copy-paste', async ({page}) => {
  const padBody = await getPadBody(page);
  await clearPadContent(page);

  // Type text and bold it
  await writeToPad(page, 'bold text');
  await selectAllText(page);
  await page.keyboard.down('Control');
  await page.keyboard.press('b');
  await page.keyboard.up('Control');
  await page.keyboard.press('End');

  // Verify bold applied
  await expect(padBody.locator('b').first()).toHaveText('bold text', {timeout: 5000});

  // Add separator line
  await page.keyboard.press('Enter');
  await writeToPad(page, 'normal');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // Select the bold text on line 1
  const innerFrame = page.frame('ace_inner')!;
  await innerFrame.locator('#innerdocbody div').first().click({clickCount: 3});
  await page.waitForTimeout(200);

  // Copy
  await page.keyboard.down('Control');
  await page.keyboard.press('c');
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);

  // Move to end of doc
  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');

  // Paste
  await page.keyboard.down('Control');
  await page.keyboard.press('v');
  await page.keyboard.up('Control');

  // Wait for paste + incorporation
  await page.waitForTimeout(2000);

  // Should have at least 2 bold elements (original + pasted)
  const boldCount = await padBody.locator('b').count();
  expect(boldCount).toBeGreaterThanOrEqual(2);
});
