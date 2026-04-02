import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

// Regression test for https://github.com/ether/etherpad-lite/issues/6710
test.describe('Page Up / Page Down', function () {
  test.describe.configure({retries: 2});

  test('PageDown moves caret forward by a page of lines', async function ({page}) {
    const padBody = await getPadBody(page);
    await clearPadContent(page);

    // Create enough lines to require scrolling (more than a viewport)
    for (let i = 0; i < 60; i++) {
      await writeToPad(page, `line ${i + 1}`);
      await page.keyboard.press('Enter');
    }

    // Move caret to the first line
    await page.keyboard.down('Control');
    await page.keyboard.press('Home');
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    // Press PageDown — the handler uses a 200ms setTimeout internally
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(1000);

    // The caret should have moved significantly forward (not stuck at the bottom of first viewport)
    // Get the current line by checking which div has the caret
    const innerFrame = page.frame('ace_inner')!;
    const selection = await innerFrame.evaluate(() => {
      const sel = document.getSelection();
      if (!sel || !sel.focusNode) return 0;
      // Walk up to find the div
      let node = sel.focusNode as HTMLElement;
      while (node && node.tagName !== 'DIV') node = node.parentElement!;
      if (!node) return 0;
      // Find the index of this div
      const divs = Array.from(document.getElementById('innerdocbody')!.children);
      return divs.indexOf(node);
    });

    // The caret should have advanced (viewport may be small in headless mode)
    expect(selection).toBeGreaterThan(2);
  });

  test('PageUp moves caret backward by a page of lines', async function ({page}) {
    const padBody = await getPadBody(page);
    await clearPadContent(page);

    // Create enough lines
    for (let i = 0; i < 60; i++) {
      await writeToPad(page, `line ${i + 1}`);
      await page.keyboard.press('Enter');
    }

    // Move caret to the last line
    await page.keyboard.down('Control');
    await page.keyboard.press('End');
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    // Press PageUp
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(500);

    // The caret should have moved significantly backward
    const innerFrame = page.frame('ace_inner')!;
    const selection = await innerFrame.evaluate(() => {
      const sel = document.getSelection();
      if (!sel || !sel.focusNode) return 999;
      let node = sel.focusNode as HTMLElement;
      while (node && node.tagName !== 'DIV') node = node.parentElement!;
      if (!node) return 999;
      const divs = Array.from(document.getElementById('innerdocbody')!.children);
      return divs.indexOf(node);
    });

    // The caret should be well before the last line (at least 10 lines from end)
    expect(selection).toBeLessThan(50);
  });

  test('PageDown then PageUp returns to approximately same position', async function ({page}) {
    const padBody = await getPadBody(page);
    await clearPadContent(page);

    for (let i = 0; i < 60; i++) {
      await writeToPad(page, `line ${i + 1}`);
      await page.keyboard.press('Enter');
    }

    // Start at top
    await page.keyboard.down('Control');
    await page.keyboard.press('Home');
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    // PageDown then PageUp
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(1000);
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(1000);

    // Should be back near the top
    const innerFrame = page.frame('ace_inner')!;
    const selection = await innerFrame.evaluate(() => {
      const sel = document.getSelection();
      if (!sel || !sel.focusNode) return 999;
      let node = sel.focusNode as HTMLElement;
      while (node && node.tagName !== 'DIV') node = node.parentElement!;
      if (!node) return 999;
      const divs = Array.from(document.getElementById('innerdocbody')!.children);
      return divs.indexOf(node);
    });

    // Should be back near the start (allow some drift due to viewport calculations)
    expect(selection).toBeLessThan(8);
  });
});
