import {expect, test} from '@playwright/test';
import {getPadBody, goToNewPad} from '../helper/padHelper.js';

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

test('toolbar select change returns focus to the pad editor (#7589)', async ({page}) => {
  // Regression: after picking a value from a toolbar select (ep_headings
  // style picker is the canonical example), the caret should return to
  // the pad editor so typing continues instead of being swallowed by
  // the select wrapper.
  const hs = page.locator('#heading-selection');
  if ((await hs.count()) === 0) {
    test.skip(true, 'ep_headings2 not enabled in this environment');
    return;
  }

  const padBody = await getPadBody(page);
  await padBody.click();
  await page.keyboard.type('before');

  // Change the heading style. The native <select> is hidden behind the
  // nice-select wrapper, which on option click does `val(x).trigger('change')`
  // internally (see src/static/js/vendors/nice-select.ts). Replicate that
  // directly rather than trying to click through the wrapper UI.
  await hs.evaluate((el: HTMLSelectElement) => {
    el.value = '0';
    el.dispatchEvent(new Event('change', {bubbles: true}));
  });

  // After the change, keyboard input should go into the pad, not the
  // toolbar. Write a marker and verify both chunks appear in the pad.
  await page.keyboard.type('after');
  await page.waitForTimeout(200);
  const bodyText = await padBody.innerText();
  expect(bodyText).toContain('before');
  expect(bodyText).toContain('after');
});
