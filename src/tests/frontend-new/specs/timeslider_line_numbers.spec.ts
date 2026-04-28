import {expect, test} from "@playwright/test";
import {clearPadContent, goToNewPad, writeToPad} from "../helper/padHelper";
import {showSettings} from "../helper/settingsHelper";

test.describe('timeslider line numbers', function () {
  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  test('shows line numbers aligned with the rendered document lines', async function ({page}) {
    test.skip(process.env.WITH_PLUGINS === '1', 'flaky in with-plugins suite — see #7611');
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'One\nTwo\nThree');
    await page.waitForTimeout(1000);

    await page.goto(`http://localhost:9001/p/${padId}/timeslider`);
    await page.waitForSelector('#timeslider-wrapper', {state: 'visible'});
    await page.waitForSelector('#sidediv.sidedivdelayed', {state: 'attached'});
    await page.waitForTimeout(1000);

    await expect(page.locator('#sidediv')).toBeVisible();
    await expect(page.locator('#sidediv .line-number').nth(0)).toHaveText('1');
    await expect(page.locator('#sidediv .line-number').nth(1)).toHaveText('2');
    await expect(page.locator('#sidediv .line-number').nth(2)).toHaveText('3');

    const counts = await page.evaluate(() => ({
      docLines: document.querySelector('#innerdocbody')?.children.length,
      gutterLines: document.querySelector('#sidedivinner')?.children.length,
    }));
    expect(counts.gutterLines).toBe(counts.docLines);

    const alignment = await page.evaluate(() => {
      const innerdocbody = document.querySelector('#innerdocbody');
      const sidediv = document.querySelector('#sidediv');
      const docLines = [...document.querySelectorAll('#innerdocbody > div')];
      const gutterLines = [...document.querySelectorAll('#sidedivinner > div')];
      const sideRect = sidediv?.getBoundingClientRect();
      const innerRect = innerdocbody?.getBoundingClientRect();
      return {
        gap: sideRect && innerRect ? Math.abs(innerRect.left - sideRect.right) : null,
      };
    });

    expect(alignment.gap).not.toBeNull();
    expect(alignment.gap!).toBeLessThanOrEqual(2);
  });

  test('inherits and persists the line-number preference from the shared cookie', async function ({page}) {
    const padId = await goToNewPad(page);
    await page.context().addCookies([{
      name: 'prefsHttp',
      value: encodeURIComponent(JSON.stringify({showLineNumbers: false})),
      url: 'http://localhost:9001',
    }]);

    await page.goto(`http://localhost:9001/p/${padId}/timeslider`);
    await page.waitForSelector('#timeslider-wrapper', {state: 'visible'});
    await showSettings(page);

    await expect(page.locator('#options-linenoscheck')).not.toBeChecked();
    await expect(page.locator('body')).toHaveClass(/line-numbers-hidden/);

    await page.locator('label[for="options-linenoscheck"]').click();
    await expect(page.locator('#options-linenoscheck')).toBeChecked();
    await expect(page.locator('body')).not.toHaveClass(/line-numbers-hidden/);

    await page.reload();
    await page.waitForSelector('#timeslider-wrapper', {state: 'visible'});
    await expect(page.locator('#options-linenoscheck')).toBeChecked();
    await expect(page.locator('body')).not.toHaveClass(/line-numbers-hidden/);
  });
});
