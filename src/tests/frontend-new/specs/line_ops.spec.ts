import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad} from "../helper/padHelper";

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

// Coverage for https://github.com/ether/etherpad/issues/6433 — IDE-style
// line operations for collaborative markdown / code editing.
test.describe('Line ops (#6433)', function () {
  test.describe.configure({retries: 2});

  const bodyLines = async (page) => {
    const inner = page.frame('ace_inner')!;
    return await inner.evaluate(
        () => Array.from(document.getElementById('innerdocbody')!.children)
            .map((d) => (d as HTMLElement).innerText));
  };

  test('Ctrl+Shift+D duplicates the current line below itself', async function ({page}) {
    const body = await getPadBody(page);
    await body.click();
    await clearPadContent(page);

    await page.keyboard.type('alpha');
    await page.keyboard.press('Enter');
    await page.keyboard.type('beta');
    await page.keyboard.press('Enter');
    await page.keyboard.type('gamma');
    await page.waitForTimeout(200);

    // Caret is on "gamma" — duplicating should yield "gamma" twice.
    await page.keyboard.press('Control+Shift+D');
    await page.waitForTimeout(400);

    const lines = await bodyLines(page);
    // Expect: alpha, beta, gamma, gamma (trailing empty div may or may not appear)
    expect(lines.slice(0, 4)).toEqual(['alpha', 'beta', 'gamma', 'gamma']);
  });

  test('Ctrl+Shift+K deletes the current line', async function ({page}) {
    const body = await getPadBody(page);
    await body.click();
    await clearPadContent(page);

    await page.keyboard.type('alpha');
    await page.keyboard.press('Enter');
    await page.keyboard.type('beta');
    await page.keyboard.press('Enter');
    await page.keyboard.type('gamma');
    // Move caret to line 2 ("beta").
    await page.keyboard.down('Control');
    await page.keyboard.press('Home');
    await page.keyboard.up('Control');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    await page.keyboard.press('Control+Shift+K');
    await page.waitForTimeout(400);

    const lines = await bodyLines(page);
    expect(lines.slice(0, 2)).toEqual(['alpha', 'gamma']);
  });

  test('Ctrl+Shift+D duplicates every line in a multi-line selection', async function ({page}) {
    const body = await getPadBody(page);
    await body.click();
    await clearPadContent(page);

    await page.keyboard.type('alpha');
    await page.keyboard.press('Enter');
    await page.keyboard.type('beta');
    await page.keyboard.press('Enter');
    await page.keyboard.type('gamma');
    await page.waitForTimeout(200);

    // Select all three lines top-to-bottom.
    await page.keyboard.down('Control');
    await page.keyboard.press('Home');
    await page.keyboard.up('Control');
    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    await page.keyboard.press('Control+Shift+D');
    await page.waitForTimeout(500);

    const lines = await bodyLines(page);
    expect(lines.slice(0, 6)).toEqual(
        ['alpha', 'beta', 'gamma', 'alpha', 'beta', 'gamma']);
  });
});
