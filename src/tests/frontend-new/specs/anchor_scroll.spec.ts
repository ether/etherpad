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

  test('reapply loop exits early once the target offset is stable', async ({page}) => {
    await goToNewPad(page);
    const padUrl = page.url();
    await clearPadContent(page);
    await writeToPad(page, Array.from({length: 30}, (_v, i) => `Line ${i + 1}`).join('\n'));
    await page.waitForTimeout(1000);

    await page.goto('about:blank');
    await page.goto(`${padUrl}#L20`);
    await page.waitForSelector('iframe[name="ace_outer"]');
    await page.waitForSelector('#editorcontainer.initialized');

    const outerDoc = page.frameLocator('iframe[name="ace_outer"]').locator('#outerdocbody');
    const getScrollTop = async () => await outerDoc.evaluate(
        (el) => el.parentElement?.scrollTop || 0);

    await expect.poll(getScrollTop).toBeGreaterThan(10);
    // Wait long enough for the stable-tick early-exit (3 ticks * 250ms + slack), well
    // under the 10s hard timeout. After early-exit, scrolling away from the anchor must
    // not be reverted by another reapply tick.
    await page.waitForTimeout(2000);

    await outerDoc.evaluate((el) => {
      if (el.parentElement) el.parentElement.scrollTop = 0;
    });
    await page.waitForTimeout(1500);
    expect(await getScrollTop()).toBeLessThanOrEqual(20);
  });

  test('user scroll cancels the reapply loop so navigation is not locked', async ({page}) => {
    await goToNewPad(page);
    const padUrl = page.url();
    await clearPadContent(page);
    await writeToPad(page, Array.from({length: 30}, (_v, i) => `Line ${i + 1}`).join('\n'));
    await page.waitForTimeout(1000);

    await page.goto('about:blank');
    await page.goto(`${padUrl}#L20`);
    await page.waitForSelector('iframe[name="ace_outer"]');
    await page.waitForSelector('#editorcontainer.initialized');

    const outerDoc = page.frameLocator('iframe[name="ace_outer"]').locator('#outerdocbody');
    const getScrollTop = async () => await outerDoc.evaluate(
        (el) => el.parentElement?.scrollTop || 0);

    await expect.poll(getScrollTop).toBeGreaterThan(10);

    // User interacts with the pad. The anchor-scroll handler listens for
    // wheel/mousedown/keydown/touchmove on the outer iframe document and must cancel
    // its reapply loop. We dispatch a mousedown on the outer document, then reset
    // scrollTop to 0 and verify it stays there.
    await outerDoc.evaluate((el) => {
      const doc = el.ownerDocument;
      doc.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
      if (el.parentElement) el.parentElement.scrollTop = 0;
    });

    // Give the reapply loop several ticks to attempt a re-scroll. If cancellation worked,
    // scrollTop stays near 0 instead of snapping back to the anchor.
    await page.waitForTimeout(1500);
    expect(await getScrollTop()).toBeLessThanOrEqual(20);
  });
});
