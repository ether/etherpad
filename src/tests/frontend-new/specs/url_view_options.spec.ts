import {expect, Page, test} from '@playwright/test';
import {goToNewPad} from '../helper/padHelper';

// Covers the URL-param view overrides that share the same _afterHandshake
// race as rtl=false (fixed in #7464). Each test loads a pad with the URL
// param in the initial navigation so the race actually fires, instead of
// applying the param via a second goto on an already-initialized pad.

test.beforeEach(async ({context}) => {
  await context.clearCookies();
});

const navigateWithParam = async (page: Page, padId: string, param: string) => {
  await page.goto(`http://localhost:9001/p/${padId}?${param}`);
  await page.waitForSelector('iframe[name="ace_outer"]');
  await page.waitForSelector('#editorcontainer.initialized');
};

test.describe('URL-param view options apply on initial load (race-free)', function () {
  test('?showLineNumbers=false hides the line-number gutter on first paint', async function ({page}) {
    const padId = await goToNewPad(page);
    await navigateWithParam(page, padId, 'showLineNumbers=false');

    const outerBody = page.frameLocator('iframe[name="ace_outer"]').locator('body');
    await expect(outerBody).toHaveClass(/line-numbers-hidden/);
    await expect(page.locator('#options-linenoscheck')).not.toBeChecked();
  });

  test('?showLineNumbers=true keeps the gutter visible (no regression)', async function ({page}) {
    const padId = await goToNewPad(page);
    await navigateWithParam(page, padId, 'showLineNumbers=true');

    const outerBody = page.frameLocator('iframe[name="ace_outer"]').locator('body');
    await expect(outerBody).not.toHaveClass(/line-numbers-hidden/);
    await expect(page.locator('#options-linenoscheck')).toBeChecked();
  });

  test('?useMonospaceFont=true applies monospace on first paint', async function ({page}) {
    const padId = await goToNewPad(page);
    await navigateWithParam(page, padId, 'useMonospaceFont=true');

    // padFontFamily=RobotoMono is mirrored onto the inner body via
    // setProperty('textface', ...) AND onto the #viewfontmenu select;
    // the same race that drops showLineNumbers also drops the select
    // value back to empty when the param fires before padeditor.init
    // resolves.
    await expect(page.locator('#viewfontmenu')).toHaveValue('RobotoMono');
  });
});
