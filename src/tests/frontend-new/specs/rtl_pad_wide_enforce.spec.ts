import {expect, test} from "@playwright/test";
import {goToNewPad} from "../helper/padHelper";
import {showSettings} from "../helper/settingsHelper";

// Regression test for ether/etherpad#7900.
//
// The pad creator is never "enforced upon themselves" (they can always edit
// pad settings), so their personal view overrides (cookies) are always merged
// on top of the pad-wide options in getEffectivePadOptions. A creator who had
// at some point toggled their personal "Read content from right to left"
// carried a stale rtlIsTrue=false cookie that silently masked the pad-wide RTL
// value they later set — the pad content stayed LTR and the pad-wide control
// appeared to "do nothing".
//
// Fix: changePadViewOption syncs the creator's personal pref to the value they
// chose, so their own view adopts the pad-wide setting immediately (while still
// allowing them to override it afterwards via the "My view" controls).
test.beforeEach(async ({page}) => {
  // Clear cookies on the context of the page under test (not a throwaway
  // context) so the test reliably starts without a stale rtlIsTrue pref.
  await page.context().clearCookies();
  await goToNewPad(page);
});

test.describe('RTL pad-wide + enforce', function () {
  test('pad-wide RTL applies to the creator even with a stale personal setting', {tag: '@feature:rtl-toggle'}, async function ({page}) {
    const innerBody = page
      .frameLocator('iframe[name="ace_outer"]')
      .frameLocator('iframe[name="ace_inner"]')
      .locator('#innerdocbody');
    const computedDir = () => innerBody.evaluate((el) =>
        el.ownerDocument.defaultView!.getComputedStyle(el).direction);

    await showSettings(page);

    // The checkboxes are visually replaced by styled labels, so drive the UI
    // the way a user does — by clicking the labels.
    // The creator first toggles their PERSONAL RTL on, then off. This writes a
    // personal cookie pref rtlIsTrue=false that used to mask the pad-wide value.
    await page.locator('label[for="options-rtlcheck"]').click();
    await expect(page.locator('#options-rtlcheck')).toBeChecked();
    await expect.poll(computedDir).toBe('rtl');
    await page.locator('label[for="options-rtlcheck"]').click();
    await expect(page.locator('#options-rtlcheck')).not.toBeChecked();
    await expect.poll(computedDir).toBe('ltr');

    // Pad-wide settings are visible because the new pad's first user is its
    // creator (canEditPadSettings). Setting pad-wide RTL must now flip the
    // creator's own content despite the stale personal cookie...
    await page.locator('label[for="padsettings-options-rtlcheck"]').click();
    await expect(page.locator('#padsettings-options-rtlcheck')).toBeChecked();
    await expect.poll(computedDir).toBe('rtl');
    await expect(innerBody).toHaveClass(/\brtl\b/);
    // ...and the personal control reflects the synced value.
    await expect(page.locator('#options-rtlcheck')).toBeChecked();

    // Enforcing for other users keeps the creator's content RTL.
    await page.locator('label[for="padsettings-enforcecheck"]').click();
    await expect(page.locator('#padsettings-enforcecheck')).toBeChecked();
    await expect.poll(computedDir).toBe('rtl');
  });
});
