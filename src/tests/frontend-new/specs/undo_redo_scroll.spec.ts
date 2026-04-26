import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad} from "../helper/padHelper.js";

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

// Regression test for https://github.com/ether/etherpad/issues/7007
//
// Pre-fix: after undo on a large pad, the viewport did not scroll to
// follow the caret. When the caret landed below the current viewport,
// src/static/js/scroll.ts's caretIsBelowOfViewport branch ran
// `outer.scrollTo(0, outer[0].innerHeight)` — a fixed offset, not the
// caret position — so the user couldn't see what had just been
// modified. That special-case was intended for "Enter at the very end
// of the pad" (PR #4639); it misbehaved whenever undo/redo or another
// path moved the caret to an arbitrary line below the viewport.
test.describe('Undo scroll-to-caret (#7007)', function () {
  test.describe.configure({retries: 2});

  // Use the Etherpad keyboard path so the undo module has real
  // changesets to replay. 45 lines is enough to push the pad well past
  // a typical CI headless viewport (~900px × ~20px per line).
  const LINE_COUNT = 45;

  test('Ctrl+Z scrolls viewport up when the caret lands above the view', async function ({page}) {
    await (await getPadBody(page)).click();
    await clearPadContent(page);

    // Type LINE_COUNT short lines through the real editor (so every line
    // lands in a changeset the undo module can reverse).
    for (let i = 0; i < LINE_COUNT; i++) {
      await page.keyboard.type(`line ${i + 1}`);
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(300);

    // Move caret to the top, insert a single edit the undo will reverse.
    await page.keyboard.down('Control');
    await page.keyboard.press('Home');
    await page.keyboard.up('Control');
    await page.keyboard.type('X');
    await page.waitForTimeout(300);

    // Scroll the outer frame all the way down so the edit is out of view.
    const outerFrame = page.frame('ace_outer')!;
    await outerFrame.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(300);

    const scrollBefore = await outerFrame.evaluate(
        () => window.scrollY || document.scrollingElement?.scrollTop || 0);
    expect(scrollBefore).toBeGreaterThan(0); // sanity: viewport actually scrolled

    // Undo — caret returns to the top, viewport should follow.
    await page.keyboard.press('Control+Z');
    // scrollNodeVerticallyIntoView's caret-below branch uses a 150ms
    // setTimeout; give it a generous budget for CI.
    await page.waitForTimeout(800);

    const scrollAfter = await outerFrame.evaluate(
        () => window.scrollY || document.scrollingElement?.scrollTop || 0);

    // Pre-fix: scrollAfter ≈ scrollBefore (no scroll).
    // Fixed: scrollAfter < scrollBefore (viewport moved up toward the caret).
    expect(scrollAfter).toBeLessThan(scrollBefore);
  });

  test('Ctrl+Z scrolls viewport down when the caret lands below the view', async function ({page}) {
    await (await getPadBody(page)).click();
    await clearPadContent(page);

    for (let i = 0; i < LINE_COUNT; i++) {
      await page.keyboard.type(`line ${i + 1}`);
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(300);

    // Caret is already at the bottom (after the last Enter). Type an
    // edit there, then scroll to top.
    await page.keyboard.type('Y');
    await page.waitForTimeout(300);

    const outerFrame = page.frame('ace_outer')!;
    await outerFrame.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    const scrollBefore = await outerFrame.evaluate(
        () => window.scrollY || document.scrollingElement?.scrollTop || 0);
    expect(scrollBefore).toBe(0);

    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(800);

    const scrollAfter = await outerFrame.evaluate(
        () => window.scrollY || document.scrollingElement?.scrollTop || 0);

    // Pre-fix: scrollAfter was pinned to outer[0].innerHeight (a fixed
    // offset) or stayed at 0; either way it was not the caret location.
    // Fixed: the viewport scrolls down toward the caret at the bottom.
    expect(scrollAfter).toBeGreaterThan(0);
  });
});
