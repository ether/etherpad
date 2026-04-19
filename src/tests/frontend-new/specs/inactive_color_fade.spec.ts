import {expect, test} from "@playwright/test";
import {appendQueryParams, goToNewPad} from "../helper/padHelper";

test.beforeEach(async ({page, browser}) => {
  const context = await browser.newContext();
  await context.clearCookies();
  await goToNewPad(page);
});

test.describe('fadeInactiveAuthorColors URL parameter (issue #7138)', function () {
  test('defaults to true (legacy fade behavior preserved)', async function ({page}) {
    const fade = await page.evaluate(() => (window as any).clientVars?.padOptions?.fadeInactiveAuthorColors);
    expect(fade).toBe(true);
  });

  test('fadeInactiveAuthorColors=false disables the fade', async function ({page}) {
    await appendQueryParams(page, {fadeInactiveAuthorColors: 'false'});
    const fade = await page.evaluate(
        () => (window as any).clientVars?.padOptions?.fadeInactiveAuthorColors);
    expect(fade).toBe(false);
  });
});
