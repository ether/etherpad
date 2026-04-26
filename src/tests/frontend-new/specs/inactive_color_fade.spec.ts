import {expect, test} from "@playwright/test";
import {appendQueryParams, goToNewPad} from "../helper/padHelper";

test.beforeEach(async ({page}) => {
  // clearCookies on the page's own context — `browser.newContext()`
  // creates a separate context that the `page` fixture doesn't use,
  // so clearing cookies on it is a no-op (Qodo review feedback).
  await page.context().clearCookies();
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
