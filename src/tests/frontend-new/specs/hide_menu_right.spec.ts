import {expect, test} from "@playwright/test";
import {appendQueryParams, goToNewPad} from "../helper/padHelper";

test.beforeEach(async ({page, browser}) => {
  const context = await browser.newContext();
  await context.clearCookies();
  await goToNewPad(page);
});

test.describe('showMenuRight URL parameter', function () {
  test('without the parameter, .menu_right is visible', async function ({page}) {
    await expect(page.locator('#editbar .menu_right')).toBeVisible();
  });

  test('showMenuRight=false hides .menu_right', async function ({page}) {
    await appendQueryParams(page, {showMenuRight: 'false'});
    await expect(page.locator('#editbar .menu_right')).toBeHidden();
    // The left menu stays visible so the pad remains navigable.
    await expect(page.locator('#editbar .menu_left')).toBeVisible();
  });

  test('showMenuRight with any other value leaves .menu_right visible', async function ({page}) {
    await appendQueryParams(page, {showMenuRight: 'true'});
    await expect(page.locator('#editbar .menu_right')).toBeVisible();
  });
});
