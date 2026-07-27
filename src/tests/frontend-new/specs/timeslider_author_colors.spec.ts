import {expect, test} from "@playwright/test";
import {clearPadContent, goToNewPad, writeToPad} from "../helper/padHelper";

test.describe('timeslider authorship colors', function () {
  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  test('respects showAuthorshipColors=false cookie from pad editor', async function ({page}) {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'Hello from author one');

    await page.context().addCookies([{
      name: 'prefsHttp',
      value: encodeURIComponent(JSON.stringify({showAuthorshipColors: false})),
      url: 'http://localhost:9001',
    }]);

    await page.goto(`http://localhost:9001/p/${padId}/timeslider?embed=1`);
    await page.waitForSelector('#timeslider-wrapper', {state: 'visible'});
    await page.waitForTimeout(500);

    await expect(page.locator('#innerdocbody')).not.toHaveClass(/authorColors/);
  });

  test('shows author colors by default (cookie unset)', async function ({page}) {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'Hello from author one');

    await page.goto(`http://localhost:9001/p/${padId}/timeslider?embed=1`);
    await page.waitForSelector('#timeslider-wrapper', {state: 'visible'});
    await page.waitForTimeout(500);

    await expect(page.locator('#innerdocbody')).toHaveClass(/authorColors/);
  });

  test('font type selector applies font-family to innerdocbody', async function ({page}) {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'Test content');

    await page.goto(`http://localhost:9001/p/${padId}/timeslider?embed=1`);
    await page.waitForSelector('#timeslider-wrapper', {state: 'visible'});
    await page.waitForTimeout(500);

    // Use evaluate() to trigger font change via jQuery, bypassing the
    // nice-select UI and settings-popup open/close lifecycle.
    await page.evaluate(() => {
      const el = document.getElementById('viewfontmenu') as HTMLSelectElement;
      if (el) {
        el.value = 'RobotoMono';
        el.dispatchEvent(new Event('change', {bubbles: true}));
      }
    });
    await page.waitForTimeout(200);

    const fontFamily = await page.locator('#innerdocbody').evaluate(
        (el) => getComputedStyle(el).fontFamily);
    expect(fontFamily).toContain('RobotoMono');
  });

  test('font-type selection persists and restores from cookie', async function ({page, context}) {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'Test content');

    // Set font cookie before loading timeslider
    await context.addCookies([{
      name: 'prefsHttp',
      value: encodeURIComponent(JSON.stringify({padFontFamily: 'Alegreya'})),
      url: 'http://localhost:9001',
    }]);

    await page.goto(`http://localhost:9001/p/${padId}/timeslider?embed=1`);
    await page.waitForSelector('#timeslider-wrapper', {state: 'visible'});
    await page.waitForTimeout(500);

    const fontFamily = await page.locator('#innerdocbody').evaluate(
        (el) => getComputedStyle(el).fontFamily);
    expect(fontFamily).toContain('Alegreya');
  });
});
