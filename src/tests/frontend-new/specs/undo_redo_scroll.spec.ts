import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad} from "../helper/padHelper";

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

// Regression test for https://github.com/ether/etherpad/issues/7007
//
// Pre-fix: after undo/redo on a large pad, the viewport did not scroll
// to follow the caret. When the caret landed below the current viewport,
// src/static/js/scroll.ts's caretIsBelowOfViewport branch ran
// `outer.scrollTo(0, outer[0].innerHeight)` — a fixed offset, not the
// caret position — so the user couldn't see what had just been
// modified. That special-case was intended for "Enter at the very end
// of the pad" (PR #4639); it misbehaved for any other case that put
// the caret below the viewport, including undo/redo jumps.
test.describe('Undo/redo scroll-to-caret (#7007)', function () {
  test.describe.configure({retries: 2});

  test('Ctrl+Z scrolls viewport to caret when it lands above the view', async function ({page}) {
    const padBody = await getPadBody(page);
    await padBody.click();
    await clearPadContent(page);

    // Build a pad with enough lines that the viewport needs to scroll.
    // 120 lines × ~20px per line ≫ typical 600-900px viewport in CI.
    const innerFrame = page.frame('ace_inner')!;
    await innerFrame.evaluate(() => {
      const body = document.getElementById('innerdocbody')!;
      body.innerHTML = '';
      for (let i = 0; i < 120; i++) {
        const div = document.createElement('div');
        div.textContent = `line ${i + 1}`;
        body.appendChild(div);
      }
      body.dispatchEvent(new Event('input', {bubbles: true}));
    });

    // Nudge the editor so the changes are internalized.
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.waitForTimeout(300);

    // Type a char near the top — this creates an undo-able edit whose
    // location is at (roughly) the top of the pad.
    await page.keyboard.down('Control');
    await page.keyboard.press('Home');
    await page.keyboard.up('Control');
    await page.keyboard.type('X');
    await page.waitForTimeout(200);

    // Scroll to the bottom so the edit is now out of view above.
    const outerFrame = page.frame('ace_outer')!;
    await outerFrame.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(200);

    const scrollBefore = await outerFrame.evaluate(
        () => window.scrollY || document.scrollingElement?.scrollTop || 0);

    // Ctrl+Z undo — caret returns to the top of the pad.
    await page.keyboard.press('Control+Z');
    // scrollNodeVerticallyIntoView uses a 150ms setTimeout internally.
    await page.waitForTimeout(600);

    const scrollAfter = await outerFrame.evaluate(
        () => window.scrollY || document.scrollingElement?.scrollTop || 0);

    // Pre-fix: scrollAfter stayed ≈ scrollBefore.
    // Fixed: scrollAfter < scrollBefore (viewport moved up toward the caret).
    expect(scrollAfter).toBeLessThan(scrollBefore);
  });

  test('Ctrl+Z scrolls viewport to caret when it lands below the view', async function ({page}) {
    const padBody = await getPadBody(page);
    await padBody.click();
    await clearPadContent(page);

    const innerFrame = page.frame('ace_inner')!;
    await innerFrame.evaluate(() => {
      const body = document.getElementById('innerdocbody')!;
      body.innerHTML = '';
      for (let i = 0; i < 120; i++) {
        const div = document.createElement('div');
        div.textContent = `line ${i + 1}`;
        body.appendChild(div);
      }
      body.dispatchEvent(new Event('input', {bubbles: true}));
    });

    // Nudge the editor
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.waitForTimeout(300);

    // Make an edit near the bottom.
    await page.keyboard.down('Control');
    await page.keyboard.press('End');
    await page.keyboard.up('Control');
    await page.keyboard.type('Y');
    await page.waitForTimeout(200);

    // Scroll up so the edit is out of view below.
    const outerFrame = page.frame('ace_outer')!;
    await outerFrame.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);

    const scrollBefore = await outerFrame.evaluate(
        () => window.scrollY || document.scrollingElement?.scrollTop || 0);

    // Ctrl+Z undo — caret goes back to the bottom.
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(600);

    const scrollAfter = await outerFrame.evaluate(
        () => window.scrollY || document.scrollingElement?.scrollTop || 0);

    // Pre-fix: scrolled to outer[0].innerHeight (a fixed offset), which in
    // the worst case did nothing useful. Fixed: viewport moves down toward
    // the caret so scrollAfter > scrollBefore.
    expect(scrollAfter).toBeGreaterThan(scrollBefore);
  });
});
