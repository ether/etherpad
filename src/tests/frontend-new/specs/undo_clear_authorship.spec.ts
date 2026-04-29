import {expect, test} from "@playwright/test";
import {
  clearAuthorship,
  clearPadContent,
  getPadBody,
  goToNewPad,
  goToPad,
  selectAllText,
  undoChanges,
  writeToPad
} from "../helper/padHelper";

/**
 * Tests for https://github.com/ether/etherpad-lite/issues/2802
 *
 * Reproduction steps from the bug report:
 * 1. User A logs in, enables author colors, types something
 * 2. User B logs in to same pad, enables author colors, types something
 * 3. User B clicks "clear authorship colors"
 * 4. User B clicks "undo"
 * => User B is disconnected from the pad
 *
 * The undo of clear authorship re-applies author attributes for all authors,
 * but the server rejects it because User B is submitting changes containing
 * User A's author ID.
 */
test.describe('undo clear authorship colors with multiple authors (bug #2802)', function () {
  test.describe.configure({ retries: 2 });
  let padId: string;

  test('User B should not be disconnected after undoing clear authorship', async function ({browser}) {
    // User 1 creates a pad and types text
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    padId = await goToNewPad(page1);
    const body1 = await getPadBody(page1);
    await body1.click();
    await clearPadContent(page1);
    await writeToPad(page1, 'Hello from User A');

    // Wait for text to be committed
    await page1.waitForTimeout(1000);

    // Verify User A's text has authorship
    await expect(body1.locator('div span').first()).toHaveAttribute('class', /author-/);

    // User 2 joins the same pad in a different browser context (different author)
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await goToPad(page2, padId);
    const body2 = await getPadBody(page2);

    // Wait for User A's text to appear for User B
    await expect(body2.locator('div').first()).toContainText('Hello from User A', {timeout: 10000});

    // User B types on a new line
    await body2.click();
    await page2.keyboard.press('End');
    await page2.keyboard.press('Enter');
    // insertText (one input event) instead of per-key keyboard.type —
    // Firefox + WITH_PLUGINS load races and drops keystrokes; see #7625.
    await page2.keyboard.insertText('Hello from User B');

    // Both users should see both lines
    await expect(body1.locator('div').nth(1)).toContainText('Hello from User B', {timeout: 15000});

    // Verify we have authorship colors from two different authors
    await expect(body2.locator('div span').first()).toHaveAttribute('class', /author-/);

    // Accept the confirm dialog that clearAuthorship triggers
    page2.on('dialog', dialog => dialog.accept());

    // User B clears authorship colors (without selecting - clears whole pad)
    await clearAuthorship(page2);

    // Wait for clear to propagate and verify authorship is cleared. linestylefilter
    // drops attribs with empty values, so spans without authorship may have no class
    // attribute at all; use a negated class matcher that handles both cases.
    await expect(body2.locator('div span').first()).not.toHaveClass(/author-/, {timeout: 5000});

    // THIS IS THE BUG: User B undoes the clear authorship
    await undoChanges(page2);

    // User B should NOT be disconnected
    const disconnectedBanner = page2.locator('.disconnected, .unreachable');
    await expect(disconnectedBanner).not.toBeVisible();

    // The authorship colors should be restored after undo
    await expect(body2.locator('div span').first()).toHaveAttribute('class', /author-/, {timeout: 5000});

    // User B should still be able to type (not disconnected)
    await body2.click();
    await page2.keyboard.press('End');
    await page2.keyboard.press('Enter');
    await page2.keyboard.insertText('Still connected!');

    // The text should appear for User A too (proves User B is still connected and syncing)
    await expect(body1.locator('div').nth(2)).toContainText('Still connected!', {timeout: 15000});

    // Cleanup
    await context1.close();
    await context2.close();
  });

  test('single user can undo clear authorship without disconnect', async function ({page}) {
    // Even with a single user, undo of clear authorship should work
    await goToNewPad(page);
    const body = await getPadBody(page);
    await body.click();
    await clearPadContent(page);
    await writeToPad(page, 'Some text with authorship');

    await page.waitForTimeout(500);

    // Verify authorship exists
    await expect(body.locator('div span').first()).toHaveAttribute('class', /author-/);

    // Accept the confirm dialog
    page.on('dialog', dialog => dialog.accept());

    // Clear authorship (no selection - clears whole pad)
    await clearAuthorship(page);

    // Verify cleared (spans without authorship may have no class attribute at all).
    await expect(body.locator('div span').first()).not.toHaveClass(/author-/, {timeout: 5000});

    // Undo should restore authorship
    await undoChanges(page);

    // Should not be disconnected
    const disconnectedBanner = page.locator('.disconnected, .unreachable');
    await expect(disconnectedBanner).not.toBeVisible();

    // Authorship should be restored
    await expect(body.locator('div span').first()).toHaveAttribute('class', /author-/, {timeout: 5000});
  });
});
