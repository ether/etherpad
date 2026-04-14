import {expect, test} from "@playwright/test";
import {
  appendQueryParams,
  clearPadContent,
  getPadBody,
  goToNewPad,
  writeToPad,
} from "../helper/padHelper";

test.describe('showAuthorColors pad option', () => {
  test('authorship colors checkbox is checked by default', async ({page}) => {
    await goToNewPad(page);
    const checkbox = page.locator('#options-colorscheck');
    await expect(checkbox).toBeChecked();
  });

  test('noColors query param unchecks the authorship colors checkbox', async ({page}) => {
    const padId = await goToNewPad(page);
    await appendQueryParams(page, {noColors: 'true'});
    const checkbox = page.locator('#options-colorscheck');
    await expect(checkbox).not.toBeChecked();
  });

  test('toggling authorship colors checkbox works', async ({page}) => {
    await goToNewPad(page);
    const padBody = await getPadBody(page);

    await clearPadContent(page);
    await writeToPad(page, 'Hello colors');
    await expect(padBody.locator('div span').first()).toHaveAttribute('class', /author-/);

    // Uncheck colors
    const checkbox = page.locator('#options-colorscheck');
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();

    // Re-check colors
    await checkbox.click();
    await expect(checkbox).toBeChecked();
  });
});
