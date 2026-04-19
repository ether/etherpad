import {expect, Page, test} from "@playwright/test";
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

  // Helper: open the Share popup, flip it to read-only, read the r.* URL
  // back out of #linkinput. The readonly toggle is a checkbox
  // (`#readonlyinput`) that rewrites #linkinput's value live.
  const getReadonlyUrl = async (page: Page) => {
    await page.locator('.buttonicon-embed').click();
    await page.locator('#readonlyinput').check();
    const url = await page.locator('#linkinput').inputValue();
    expect(url).toMatch(/\/p\/r\./);
    return url;
  };

  test('readonly pad hides .menu_right by default', async function ({page}) {
    const readonlyUrl = await getReadonlyUrl(page);
    await page.goto(readonlyUrl);
    await page.waitForSelector('#editorcontainer.initialized');
    await expect(page.locator('#editbar .menu_right')).toBeHidden();
  });

  test('readonly pad with showMenuRight=true keeps the menu visible', async function ({page}) {
    const readonlyUrl = await getReadonlyUrl(page);
    await page.goto(`${readonlyUrl}?showMenuRight=true`);
    await page.waitForSelector('#editorcontainer.initialized');
    await expect(page.locator('#editbar .menu_right')).toBeVisible();
  });
});
