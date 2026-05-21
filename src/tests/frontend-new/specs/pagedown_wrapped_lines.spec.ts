import {expect, test} from "@playwright/test";
import {clearPadContent, goToNewPad} from "../helper/padHelper";

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

// Regression test for https://github.com/ether/etherpad/issues/4562
// PageDown failed to scroll when the cursor was on a very long wrapped line and
// the following lines were also very long, because getVisibleLineRange returns
// indices into rep.lines (logical lines) and collapsed to [n, n] — so the
// advance count was 0 and both caret and scroll stayed put.
test.describe('PageDown on consecutive long wrapped lines (#4562)', function () {
  test.describe.configure({retries: 2});

  test('PageDown scrolls when three very long lines fill the viewport', async function ({page}) {
    await clearPadContent(page);

    const innerFrame = page.frame('ace_inner')!;

    // Insert three long lines via the editor directly — each ~2000 chars, which
    // wraps to many visual rows in the viewport.
    await innerFrame.evaluate(() => {
      const body = document.getElementById('innerdocbody')!;
      const longText = 'invisible '.repeat(200).trim();
      body.innerHTML = '';
      for (let i = 0; i < 3; i++) {
        const div = document.createElement('div');
        div.textContent = `${i + 1} ${longText}`;
        body.appendChild(div);
      }
      // Trigger the editor to pick up the content
      body.dispatchEvent(new Event('input', {bubbles: true}));
    });

    // Type a character at the end to make the editor register the long content
    // via its normal input path (the raw innerHTML edit above is just a scaffold).
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.waitForTimeout(300);

    // Move caret to start of pad
    await page.keyboard.down('Control');
    await page.keyboard.press('Home');
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    // Capture initial scroll position of the outer (scrollable) frame
    const outerFrame = page.frame('ace_outer')!;
    const before = await outerFrame.evaluate(
        () => (document.getElementById('outerdocbody') as HTMLElement).scrollTop ||
              document.scrollingElement?.scrollTop || 0);

    // Press PageDown — the ace handler uses a 200ms setTimeout internally.
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(800);

    const after = await outerFrame.evaluate(
        () => (document.getElementById('outerdocbody') as HTMLElement).scrollTop ||
              document.scrollingElement?.scrollTop || 0);

    // Either the viewport scrolled, or the caret advanced to a later logical line.
    const caretLine = await innerFrame.evaluate(() => {
      const sel = document.getSelection();
      if (!sel || !sel.focusNode) return 0;
      let node = sel.focusNode as HTMLElement;
      while (node && node.tagName !== 'DIV') node = node.parentElement!;
      if (!node) return 0;
      const divs = Array.from(document.getElementById('innerdocbody')!.children);
      return divs.indexOf(node);
    });

    // Pre-fix behavior (#4562): after == before AND caretLine === 0.
    // Fixed behavior: caret advances at least 1 logical line, or the viewport scrolls.
    expect(after > before || caretLine > 0).toBe(true);
  });
});
