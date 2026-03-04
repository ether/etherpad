import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
  // create a new pad before each test run
  await goToNewPad(page);
})

test('should go to home on pad', async ({page}) => {
  const homeButton = page.locator('.buttonicon.buttonicon-home')
  const attribute = await homeButton.getAttribute('data-l10n-id')
  expect(attribute).toBe('pad.toolbar.home.title');

  await homeButton.click();
  const url = page.url();
  expect(url).not.toContain('/p/');
})
