import {expect, test} from "@playwright/test";
import {clearPadContent, goToNewPad, writeToPad} from "../helper/padHelper";

test.describe('anchor scrolling', () => {
  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  test('reapplies #L scroll after earlier content changes height', async ({page}) => {
    await goToNewPad(page);
    const padUrl = page.url();
    await clearPadContent(page);
    await writeToPad(page, Array.from({length: 30}, (_v, i) => `Line ${i + 1}`).join('\n'));
    await page.waitForTimeout(1000);

    await page.goto('about:blank');
    await page.goto(`${padUrl}#L20`);
    await page.waitForSelector('iframe[name="ace_outer"]');
    await page.waitForSelector('#editorcontainer.initialized');
    await page.waitForTimeout(2000);

    const outerDoc = page.frameLocator('iframe[name="ace_outer"]').locator('#outerdocbody');
    const firstLine = page.frameLocator('iframe[name="ace_outer"]')
        .frameLocator('iframe')
        .locator('#innerdocbody > div')
        .first();
    const targetLine = page.frameLocator('iframe[name="ace_outer"]')
        .frameLocator('iframe')
        .locator('#innerdocbody > div')
        .nth(19);

    const getScrollTop = async () => await outerDoc.evaluate(
        (el) => el.parentElement?.scrollTop || 0);
    const getTargetViewportTop = async () => await targetLine.evaluate((el) => el.getBoundingClientRect().top);

    await expect.poll(getScrollTop).toBeGreaterThan(10);
    const initialViewportTop = await getTargetViewportTop();

    await firstLine.evaluate((el) => {
      const filler = document.createElement('div');
      filler.style.height = '400px';
      el.appendChild(filler);
    });

    await expect.poll(async () => {
      const currentViewportTop = await getTargetViewportTop();
      return Math.abs(currentViewportTop - initialViewportTop);
    }).toBeLessThanOrEqual(80);
  });
});
