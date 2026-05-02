import {expect, test} from '@playwright/test';
import {
  goToNewPad,
  goToPad,
  isChatBoxShown,
  setUserName,
  toggleUserList,
} from '../helper/padHelper';

/**
 * Coverage for the click-a-user-to-prefill-@-mention UX added in #7660.
 *
 * Why a multi-context suite: the row click handler only runs against
 * #otheruserstable rows, so we always need a second client connected to
 * the same pad to populate that table. Each test opens the pad twice
 * with a fresh context, names the second user, then drives the click
 * from the first.
 */

const setSecondUserName = async (page2: any, name: string) => {
  await toggleUserList(page2);
  await setUserName(page2, name);
  await page2.keyboard.press('Enter');
};

test.describe('userlist click → chat prefill', {tag: '@feature:chat'}, () => {
  test('clicking another user opens chat and prefills @<name>',
      async ({browser}) => {
        const padId = await goToNewPad(await browser.newPage());
        // Hack: the line above used a throwaway page just to mint a padId.
        // Real users come below.

        const ctx1 = await browser.newContext();
        const page1 = await ctx1.newPage();
        await goToPad(page1, padId);

        const ctx2 = await browser.newContext();
        const page2 = await ctx2.newPage();
        await goToPad(page2, padId);

        await setSecondUserName(page2, 'Alice');

        // Wait for page1's user list to learn about Alice.
        await toggleUserList(page1);
        const aliceRow = page1.locator(
            '#otheruserstable tr[data-authorId] .usertdname:has-text("Alice")');
        await expect(aliceRow).toBeVisible({timeout: 10_000});

        // Sanity: chat is hidden before the click.
        expect(await isChatBoxShown(page1)).toBe(false);

        await aliceRow.click();

        // Chat should be open, input prefilled.
        await page1.waitForFunction(
            "document.querySelector('#chatbox')?.classList.contains('visible')",
            null, {timeout: 5_000});
        await page1.waitForFunction(
            "document.querySelector('#chatinput')?.value?.startsWith('@Alice ')",
            null, {timeout: 5_000});

        await ctx1.close();
        await ctx2.close();
      });

  test('clicking the swatch opens the color picker, not chat',
      async ({browser}) => {
        const padId = await goToNewPad(await browser.newPage());

        const ctx1 = await browser.newContext();
        const page1 = await ctx1.newPage();
        await goToPad(page1, padId);

        const ctx2 = await browser.newContext();
        const page2 = await ctx2.newPage();
        await goToPad(page2, padId);
        await setSecondUserName(page2, 'Bob');

        await toggleUserList(page1);
        const bobRow = page1.locator(
            '#otheruserstable tr[data-authorId] .usertdname:has-text("Bob")');
        await expect(bobRow).toBeVisible({timeout: 10_000});

        const swatch = page1.locator(
            '#otheruserstable tr[data-authorId] .usertdswatch').first();
        await swatch.click();

        // Chat should NOT be opened by a swatch click.
        // (We only check the box-state; we don't assert anything about
        // any color-picker popup since this PR doesn't change that flow.)
        await page1.waitForTimeout(300);
        expect(await isChatBoxShown(page1)).toBe(false);

        await ctx1.close();
        await ctx2.close();
      });

  test('clicking the rename input on an unnamed user does not steal focus',
      async ({browser}) => {
        const padId = await goToNewPad(await browser.newPage());

        const ctx1 = await browser.newContext();
        const page1 = await ctx1.newPage();
        await goToPad(page1, padId);

        // Second user joins but never sets a name → row renders an
        // <input data-l10n-id="pad.userlist.unnamed">.
        const ctx2 = await browser.newContext();
        const page2 = await ctx2.newPage();
        await goToPad(page2, padId);

        await toggleUserList(page1);
        const unnamedInput = page1.locator(
            '#otheruserstable input[data-l10n-id="pad.userlist.unnamed"]')
            .first();
        await expect(unnamedInput).toBeVisible({timeout: 10_000});

        // The act of clicking the input must NOT trigger the row handler.
        // Pre-fix, this opened chat and stole focus from the rename input.
        await unnamedInput.click();
        await page1.waitForTimeout(300);

        expect(await isChatBoxShown(page1)).toBe(false);
        // Focus is still on the unnamed-user input — typing reaches it,
        // not #chatinput.
        await page1.keyboard.type('Carol');
        const value = await unnamedInput.inputValue();
        expect(value).toBe('Carol');

        await ctx1.close();
        await ctx2.close();
      });

  test('partial message in chat input is preserved when prefilling',
      async ({browser}) => {
        const padId = await goToNewPad(await browser.newPage());

        const ctx1 = await browser.newContext();
        const page1 = await ctx1.newPage();
        await goToPad(page1, padId);

        const ctx2 = await browser.newContext();
        const page2 = await ctx2.newPage();
        await goToPad(page2, padId);
        await setSecondUserName(page2, 'Dave');

        await toggleUserList(page1);

        // Open chat first and type a partial message.
        await page1.locator('#chaticon').click();
        await page1.locator('#chatinput').click();
        await page1.keyboard.type('hi there');

        const daveRow = page1.locator(
            '#otheruserstable tr[data-authorId] .usertdname:has-text("Dave")');
        await expect(daveRow).toBeVisible({timeout: 10_000});
        await daveRow.click();

        // Mention should be appended, partial message preserved.
        await page1.waitForFunction(
            "document.querySelector('#chatinput')?.value?.includes('hi there')",
            null, {timeout: 5_000});
        const value = await page1.locator('#chatinput').inputValue();
        expect(value).toContain('hi there');
        expect(value).toContain('@Dave');

        await ctx1.close();
        await ctx2.close();
      });
});
