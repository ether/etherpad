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
    const user1Span = body1.locator('div').first().locator('span');
    await expect(user1Span.first()).toHaveAttribute('class', /author-/);

    // User 2 joins the same pad in a different browser context (different author)
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await goToPad(page2, padId);
    const body2 = await getPadBody(page2);

    // Wait for User A's text to appear for User B
    await expect(body2.locator('div').first()).toContainText('Hello from User A');

    // User B types on a new line
    await body2.click();
    await page2.keyboard.press('End');
    await page2.keyboard.press('Enter');
    await page2.keyboard.type('Hello from User B');

    // Wait for sync
    await page2.waitForTimeout(1000);

    // Both users should see both lines
    await expect(body1.locator('div').nth(1)).toContainText('Hello from User B');

    // Verify we have authorship colors from two different authors
    const authorSpans = body2.locator('[class*="author-"]');
    await expect(authorSpans.first()).toBeVisible();

    // User B clears authorship colors
    await body2.click();
    await selectAllText(page2);
    await clearAuthorship(page2);

    // Wait for clear to propagate
    await page2.waitForTimeout(1000);

    // Verify authorship is cleared
    const clearedBody = await getPadBody(page2);
    const authorClassesAfterClear = clearedBody.locator('[class*="author-"]');
    // After clearing, there should be no author classes
    await expect(authorClassesAfterClear).toHaveCount(0);

    // THIS IS THE BUG: User B undoes the clear authorship
    // Currently, the undo is blocked client-side as a workaround.
    // The proper fix should allow the undo without causing a disconnect.
    await undoChanges(page2);

    // Wait for the undo to take effect
    await page2.waitForTimeout(2000);

    // User B should NOT be disconnected
    const disconnectedBanner = page2.locator('.disconnected, .unreachable');
    await expect(disconnectedBanner).not.toBeVisible();

    // The authorship colors should be restored after undo
    const restoredAuthorSpans = clearedBody.locator('[class*="author-"]');
    await expect(restoredAuthorSpans.first()).toBeVisible({timeout: 5000});

    // User B should still be able to type (not disconnected)
    await body2.click();
    await page2.keyboard.press('End');
    await page2.keyboard.press('Enter');
    await page2.keyboard.type('Still connected!');

    await page2.waitForTimeout(1000);

    // The text should appear for User A too (proves User B is still connected and syncing)
    await expect(body1.locator('div').nth(2)).toContainText('Still connected!');

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
    const authorSpan = body.locator('[class*="author-"]');
    await expect(authorSpan.first()).toBeVisible();

    // Clear authorship
    await selectAllText(page);
    await clearAuthorship(page);
    await page.waitForTimeout(500);

    // Verify cleared
    await expect(body.locator('[class*="author-"]')).toHaveCount(0);

    // Undo - currently blocked by the workaround, should work with proper fix
    await undoChanges(page);
    await page.waitForTimeout(1000);

    // Should not be disconnected
    const disconnectedBanner = page.locator('.disconnected, .unreachable');
    await expect(disconnectedBanner).not.toBeVisible();

    // Authorship should be restored
    await expect(body.locator('[class*="author-"]').first()).toBeVisible({timeout: 5000});
  });
});
