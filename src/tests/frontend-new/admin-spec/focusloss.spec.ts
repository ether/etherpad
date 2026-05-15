import {expect, test} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper";

test.beforeEach(async ({ page })=>{
  await loginToAdmin(page, 'admin', 'changeme1');
})

// Regression for the byte-offset React-key bug: when a JSON edit shifted
// every sibling's character offset, React remounted every input — eating
// focus mid-keystroke. The fix keys children on their JSONPath, which is
// invariant under value-length changes.
//
// Using Playwright's `.fill()` on the source input would itself steal
// focus before we could observe whether the target survived, so we drive
// the source via the native value setter + a bubbling `input` event:
// React's synthetic onChange fires and the form re-renders, but focus
// stays on whatever the test put it on.
test('editing a sibling array element does not lose focus on the focused one', async ({page}) => {
  await page.goto('http://localhost:9001/admin/settings');
  await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});

  const firstInput = page.getByTestId('field-socketTransportProtocols.0');
  const secondInput = page.getByTestId('field-socketTransportProtocols.1');

  await expect(firstInput).toBeVisible();
  await expect(secondInput).toBeVisible();

  await secondInput.focus();
  await expect(secondInput).toBeFocused();

  await firstInput.evaluate((el, val) => {
    const desc = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value',
    );
    desc?.set?.call(el, val);
    el.dispatchEvent(new Event('input', {bubbles: true}));
  }, 'websocket-long');

  await expect(secondInput).toBeFocused();
});
