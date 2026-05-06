import {expect, test} from '@playwright/test';
import {goToNewPad} from '../helper/padHelper';

test.describe('author token cookie', () => {
  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  test('author token cookie is HttpOnly and not readable via document.cookie',
      async ({page, context}) => {
        await goToNewPad(page);

        const cookies = await context.cookies();
        const tokenCookie = cookies.find((c) => c.name.endsWith('token'));
        expect(tokenCookie,
            `cookies: ${JSON.stringify(cookies.map((c) => c.name))}`).toBeDefined();
        expect(tokenCookie!.httpOnly).toBe(true);
        expect(String(tokenCookie!.sameSite).toLowerCase()).toBe('lax');

        const jsVisible = await page.evaluate(() => document.cookie);
        expect(jsVisible).not.toContain(tokenCookie!.name);
      });

  test('authorID is stable across reload in the same context', async ({page}) => {
    await goToNewPad(page);
    const first = await page.evaluate(() => (window as any).clientVars?.userId);
    await page.reload();
    await page.waitForSelector('#editorcontainer.initialized');
    const second = await page.evaluate(() => (window as any).clientVars?.userId);
    expect(second).toBe(first);
  });

  test('authorID differs in an isolated second context', async ({page, browser, context}) => {
    const padId = await goToNewPad(page);
    const first = await page.evaluate(() => (window as any).clientVars?.userId);
    const firstCookie = (await context.cookies()).find((c) => c.name.endsWith('token'));

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(`http://localhost:9001/p/${padId}`);
    await page2.waitForSelector('#editorcontainer.initialized');
    const second = await page2.evaluate(() => (window as any).clientVars?.userId);
    const secondCookie = (await context2.cookies()).find((c) => c.name.endsWith('token'));

    expect(secondCookie?.value).not.toBe(firstCookie?.value);
    expect(second).not.toBe(first);
    await context2.close();
  });
});
