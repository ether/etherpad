import {expect, test, Page} from '@playwright/test';
import {goToNewPad, getPadBody} from '../helper/padHelper';

// End-to-end coverage for the WCAG author-colour clamp (issue #7377). Sets
// the user's colour to one of the historically-failing values and asserts
// the rendered author span on the actual DOM achieves >= 4.5:1 against the
// computed text colour. This is the test the previous PR was missing — the
// backend unit tests verified the algorithm but nothing exercised the full
// Settings -> ace2_inner -> CSS render pipeline that the issue was about.

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

const setUserColor = async (page: Page, hex: string) => {
  await page.locator('.buttonicon-showusers').click();
  await page.locator('#myswatch').click();
  await page.evaluate((hexColor: string) => {
    document.getElementById('mycolorpickerpreview')!.style.backgroundColor = hexColor;
  }, hex);
  await page.locator('#mycolorpickersave').click();
  await page.waitForTimeout(500);
};

const wcagRatio = (rgb1: string, rgb2: string): number => {
  const parse = (s: string) => s.match(/\d+/g)!.slice(0, 3).map(Number).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  const lum = (rgb: number[]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const l1 = lum(parse(rgb1));
  const l2 = lum(parse(rgb2));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const renderedAuthorContrast = async (page: Page) => {
  const body = await getPadBody(page);
  await body.click();
  await page.keyboard.type('contrast smoke');
  await page.waitForTimeout(300);
  // The author span is the inner-frame <span class="author-..."> wrapping
  // the typed text. Read its computed bg + the inherited text colour.
  const result = await page.frame('ace_inner')!.evaluate(() => {
    const span = document.querySelector(
        '#innerdocbody span[class*="author-"]:not([class*="anonymous"])') as HTMLElement | null;
    if (!span) return null;
    const cs = getComputedStyle(span);
    return {bg: cs.backgroundColor, color: cs.color};
  });
  return result;
};

// `@feature:authorship-bg-color` because every assertion here measures the
// author span's `background-color` against its computed text colour. Plugins
// that disable the author *background* colouring entirely — e.g.
// ep_author_neat2, which switches to coloured underlines — can't satisfy the
// WCAG bg/text contrast invariant (there's no background to measure). Those
// plugins declare `disables: ["@feature:authorship-bg-color"]` and the
// disables contract excludes this describe block from their pass-1 regression
// run.
test.describe('WCAG author colour (issue #7377)', {
  tag: '@feature:authorship-bg-color',
}, () => {
  test('issue scenario: #9AB3FA renders >= AA against the author text', async ({page}) => {
    await setUserColor(page, '#9AB3FA');
    const r = await renderedAuthorContrast(page);
    expect(r, 'expected an author-coloured span in the pad').not.toBeNull();
    const ratio = wcagRatio(r!.bg, r!.color);
    expect(ratio, `bg=${r!.bg} color=${r!.color} ratio=${ratio.toFixed(3)}`)
        .toBeGreaterThanOrEqual(4.5);
  });

  test('pure red #ff0000 renders >= AA after the clamp', async ({page}) => {
    await setUserColor(page, '#ff0000');
    const r = await renderedAuthorContrast(page);
    expect(r).not.toBeNull();
    const ratio = wcagRatio(r!.bg, r!.color);
    expect(ratio, `bg=${r!.bg} color=${r!.color} ratio=${ratio.toFixed(3)}`)
        .toBeGreaterThanOrEqual(4.5);
  });

  test('already-AA-friendly #ffeedd is rendered unchanged', async ({page}) => {
    await setUserColor(page, '#ffeedd');
    const r = await renderedAuthorContrast(page);
    expect(r).not.toBeNull();
    // #ffeedd → rgb(255, 238, 221). Clamp must NOT mutate this.
    expect(r!.bg).toBe('rgb(255, 238, 221)');
  });
});
