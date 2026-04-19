import {expect, test} from "@playwright/test";
import {appendQueryParams, goToNewPad} from "../helper/padHelper";

test.beforeEach(async ({page}) => {
  // clearCookies on the page's own context — creating a separate
  // BrowserContext and clearing cookies on it is a no-op for the page
  // fixture (Qodo review feedback on #7553).
  await page.context().clearCookies();
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

  test('showMenuRight=true keeps .menu_right visible', async function ({page}) {
    await appendQueryParams(page, {showMenuRight: 'true'});
    await expect(page.locator('#editbar .menu_right')).toBeVisible();
  });

  test('readonly pad hides .menu_right by default', async function ({page}) {
    // Find the share link which exposes the readonly r.* id, then navigate.
    await page.locator('.buttonicon-embed').click();
    const readonlyUrl = await page.locator('#readonlyInput').inputValue();
    expect(readonlyUrl).toMatch(/\/p\/r\./);
    await page.goto(readonlyUrl);
    await page.waitForSelector('#editorcontainer.initialized');
    await expect(page.locator('#editbar .menu_right')).toBeHidden();
  });

  test('readonly pad with showMenuRight=true keeps the menu visible', async function ({page}) {
    await page.locator('.buttonicon-embed').click();
    const readonlyUrl = await page.locator('#readonlyInput').inputValue();
    await page.goto(`${readonlyUrl}?showMenuRight=true`);
    await page.waitForSelector('#editorcontainer.initialized');
    await expect(page.locator('#editbar .menu_right')).toBeVisible();
  });
});
