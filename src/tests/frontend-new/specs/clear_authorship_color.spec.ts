import {expect, test} from "@playwright/test";
import {
  clearAuthorship,
  clearPadContent,
  getPadBody,
  goToNewPad, pressUndoButton,
  selectAllText,
  undoChanges,
  writeToPad
} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
  // create a new pad before each test run
  await goToNewPad(page);
})

test('clear authorship color', async ({page}) => {
  const padBody = await getPadBody(page);

  // type some text
  await clearPadContent(page);
  await writeToPad(page, "Hello");
  await expect(padBody.locator('div span').first()).toHaveAttribute('class', /author-/);

  // select all and clear authorship
  await padBody.click()
  await selectAllText(page);
  // Accept the confirm dialog triggered when whole document is selected
  page.on('dialog', dialog => dialog.accept());
  await clearAuthorship(page);

  // authorship should be cleared, user should not be disconnected
  await expect(padBody.locator('div').first()).not.toHaveAttribute('class', /author/, {timeout: 5000});
  await expect(page.locator('div.disconnected')).not.toBeVisible();
})


test("clear authorship colors can be undone to restore author colors", async function ({page}) {
  // Fix for https://github.com/ether/etherpad-lite/issues/2802
  // Previously, undo of clear authorship was blocked as a workaround.
  // Now the server properly allows it, so undo should restore author colors.
  const padBody = await getPadBody(page);
  const padText = "Hello"

  // type some text
  await clearPadContent(page);
  await writeToPad(page, padText);

  // verify authorship exists on the span
  const span = padBody.locator('div span').nth(0);
  await expect(span).toHaveAttribute('class', /author-/);

  await padBody.locator('div').nth(0).focus()
  await selectAllText(page);
  await clearAuthorship(page);

  // verify authorship is cleared
  await expect(padBody.locator('div').nth(0)).not.toHaveAttribute('class', /author/);

  // Undo should restore authorship colors
  await undoChanges(page);

  // verify authorship is restored and user is not disconnected
  await expect(padBody.locator('div span').nth(0)).toHaveAttribute('class', /author-/, {timeout: 5000});
  const disconnected = page.locator('.disconnected, .unreachable');
  await expect(disconnected).not.toBeVisible();
});


// Test for https://github.com/ether/etherpad-lite/issues/5128
test('clears authorship when first line has line attributes', async function ({page}) {
  // Make sure there is text with author info. The first line must have a line attribute.
  const padBody = await getPadBody(page);
  // Accept confirm dialogs before any action that might trigger one
  page.on('dialog', dialog => dialog.accept());
  await padBody.click()
  await clearPadContent(page);
  await writeToPad(page,'Hello')
  await page.locator('.buttonicon-insertunorderedlist').click({force: true});
  // Wait for the list attribute to be applied before checking authorship
  await page.waitForTimeout(500);
  await expect(padBody.locator('div span').first()).toHaveAttribute('class', /author-/);
  await padBody.click()
  await selectAllText(page);
  await clearAuthorship(page);
  // Wait longer for clear to propagate on list content
  await expect(padBody.locator('div span').first()).not.toHaveAttribute('class', /author-/, {timeout: 10000});
});
