import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

// Regression test for https://github.com/ether/etherpad/issues/7894
test.describe('long URL wrapping in pad editor', function () {
  test('long URLs should wrap instead of overflowing the editor', async function ({page}) {
    const padBody = await getPadBody(page);
    await clearPadContent(page);

    // The fix for #7894 ensures #innerdocbody a has white-space: normal,
    // word-wrap: break-word, and overflow-wrap: break-word to override
    // the global a { white-space: nowrap } from pad.css.
    const longUrl =
        'https://example.com/this/is/a/very/long/test/url/for/etherpad/regression/' +
        'issue/7894/wrapping/behavior/long/urls/should/wrap/instead/of/overflowing/' +
        'to/the/right/and/causing/awkward/rendering';

    await writeToPad(page, longUrl + ' ');

    // Verify the URL became a clickable link
    const link = padBody.locator('a');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', longUrl);

    // Verify wrapping CSS properties are applied (the direct fix for #7894)
    const cssProps = await link.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        whiteSpace: style.whiteSpace,
        wordWrap: style.wordWrap,
        overflowWrap: style.overflowWrap,
      };
    });

    expect(cssProps.whiteSpace).toBe('normal');
    expect(cssProps.wordWrap).toBe('break-word');
    expect(cssProps.overflowWrap).toBe('break-word');

    // Verify the link does not overflow the editor (actual wrapping behavior)
    const linkWidth = await link.evaluate((el) => el.getBoundingClientRect().width);
    const bodyWidth = await padBody.evaluate((el) => el.getBoundingClientRect().width);
    expect(linkWidth).toBeLessThanOrEqual(bodyWidth);
  });
});
