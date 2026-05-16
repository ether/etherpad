import {expect, test} from "@playwright/test";
import {appendQueryParams, goToNewPad} from "../helper/padHelper";
import {showSettings} from "../helper/settingsHelper";

test.beforeEach(async ({page}) => {
  // clearCookies on the page's own context — `browser.newContext()`
  // creates a separate context that the `page` fixture doesn't use,
  // so clearing cookies on it is a no-op (Qodo review feedback).
  await page.context().clearCookies();
  await goToNewPad(page);
});

test.describe('fadeInactiveAuthorColors (issue #7138)', function () {
  test('server-side default is true (legacy fade behavior preserved)', async function ({page}) {
    const fade = await page.evaluate(
        () => (window as any).clientVars?.padOptions?.fadeInactiveAuthorColors);
    expect(fade).toBe(true);
  });

  test('per-pad view default propagates from server settings', async function ({page}) {
    const fade = await page.evaluate(
        () => (window as any).clientVars?.initialOptions?.view?.fadeInactiveAuthorColors);
    expect(fade).toBe(true);
  });

  test('?fadeInactiveAuthorColors=false flips the per-pad view value', async function ({page}) {
    await appendQueryParams(page, {fadeInactiveAuthorColors: 'false'});
    const fade = await page.evaluate(
        () => (window as any).clientVars?.initialOptions?.view?.fadeInactiveAuthorColors);
    expect(fade).toBe(false);
  });

  test('My View checkbox toggles the per-user cookie', async function ({page}) {
    // Open the settings popup, untick the box, confirm the cookie pref now
    // overrides the server-default.
    await showSettings(page);
    const checkbox = page.locator('#options-fadeauthorcheck');
    await expect(checkbox).toBeChecked();
    // The label is i18n'd, not hardcoded — assert the localized string actually
    // rendered (catches missing keys, not just a present DOM node).
    await expect(page.locator('label[for="options-fadeauthorcheck"]'))
        .toHaveText('Fade inactive author colors');
    await page.locator('label[for="options-fadeauthorcheck"]').click();
    await expect(checkbox).not.toBeChecked();
    // padcookie stores prefs as a single JSON cookie. The name is `prefs` over
    // HTTPS and `prefsHttp` over HTTP, optionally with a `cookiePrefix`.
    const cookies = await page.context().cookies();
    const prefsCookie = cookies.find((c) => /(prefs|prefsHttp)$/.test(c.name));
    expect(prefsCookie, 'expected a prefs cookie after toggling').toBeDefined();
    const decoded = JSON.parse(decodeURIComponent(prefsCookie!.value));
    expect(decoded.fadeInactiveAuthorColors).toBe(false);
  });
});
