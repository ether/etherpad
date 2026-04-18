import {expect, test} from "@playwright/test";
import {goToNewPad, goToPad, sendChatMessage, showChat} from "../helper/padHelper";
import {showSettings} from "../helper/settingsHelper";

test.describe('creator-owned pad settings', () => {
  test('shows pad settings only to the creator and keeps delete pad there', async ({page, browser}) => {
    const padId = await goToNewPad(page);

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await goToPad(page2, padId);

    await showSettings(page);
    await showSettings(page2);

    await expect(page.locator('#settings h1')).toHaveText('User Settings');
    await expect(page.locator('#pad-settings-section')).toBeVisible();
    await expect(page.locator('#delete-pad')).toBeVisible();
    await expect(page.locator('#padsettings-enforcecheck')).toBeVisible();

    await expect(page2.locator('#settings h1')).toHaveText('User Settings');
    await expect(page2.locator('#pad-settings-section')).toBeHidden();
    await expect(page2.locator('#delete-pad')).toBeHidden();

    await context2.close();
  });

  test('pad settings act as defaults until enforcement is enabled', async ({page, browser}) => {
    const padId = await goToNewPad(page);

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await goToPad(page2, padId);

    const creatorOuter = page.frameLocator('iframe[name="ace_outer"]').locator('#outerdocbody');
    const creatorInner = page.frameLocator('iframe[name="ace_outer"]')
      .frameLocator('iframe[name="ace_inner"]').locator('body');
    const viewerOuter = page2.frameLocator('iframe[name="ace_outer"]').locator('#outerdocbody');
    const viewerInner = page2.frameLocator('iframe[name="ace_outer"]')
      .frameLocator('iframe[name="ace_inner"]').locator('body');

    await expect(creatorOuter).not.toHaveClass(/line-numbers-hidden/);
    await expect(creatorInner).toHaveClass(/authorColors/);
    await expect(viewerOuter).not.toHaveClass(/line-numbers-hidden/);
    await expect(viewerInner).toHaveClass(/authorColors/);

    await showSettings(page);
    await page.locator('label[for="padsettings-options-linenoscheck"]').click();
    await expect(page.locator('#padsettings-options-linenoscheck')).not.toBeChecked();
    await expect(creatorOuter).toHaveClass(/line-numbers-hidden/);
    await expect(viewerOuter).toHaveClass(/line-numbers-hidden/);

    await page.locator('label[for="padsettings-options-colorscheck"]').click();
    await expect(page.locator('#padsettings-options-colorscheck')).not.toBeChecked();
    await expect(creatorInner).not.toHaveClass(/authorColors/);
    await expect(viewerInner).not.toHaveClass(/authorColors/);

    await expect(page.locator('#options-linenoscheck')).not.toBeChecked();
    await expect(page.locator('#options-colorscheck')).not.toBeChecked();

    await showSettings(page2);
    await page2.locator('label[for="options-linenoscheck"]').click();
    await page2.locator('label[for="options-colorscheck"]').click();
    await expect(viewerOuter).not.toHaveClass(/line-numbers-hidden/, {timeout: 1000});
    await expect(viewerInner).toHaveClass(/authorColors/);
    await expect(page2.locator('#options-linenoscheck')).toBeChecked();
    await expect(page2.locator('#options-colorscheck')).toBeChecked();

    await expect(creatorOuter).toHaveClass(/line-numbers-hidden/);
    await expect(creatorInner).not.toHaveClass(/authorColors/);

    await page.locator('label[for="padsettings-enforcecheck"]').click();
    await expect(page.locator('#padsettings-enforcecheck')).toBeChecked();
    await expect(viewerOuter).toHaveClass(/line-numbers-hidden/);
    await expect(viewerInner).not.toHaveClass(/authorColors/);
    await expect(page2.locator('#options-linenoscheck')).not.toBeChecked();
    await expect(page2.locator('#options-colorscheck')).not.toBeChecked();
    await context2.close();
  });

  test('uses My View defaults for newly created pads without changing an existing pad default',
      async ({page}) => {
        await goToNewPad(page);
        const creatorOuter = page.frameLocator('iframe[name="ace_outer"]').locator('#outerdocbody');
        const creatorInner = page.frameLocator('iframe[name="ace_outer"]')
          .frameLocator('iframe[name="ace_inner"]').locator('body');

        await showSettings(page);
        await page.locator('label[for="options-linenoscheck"]').click();
        await page.locator('label[for="options-colorscheck"]').click();
        await expect(page.locator('#options-linenoscheck')).not.toBeChecked();
        await expect(page.locator('#options-colorscheck')).not.toBeChecked();
        await expect(creatorOuter).toHaveClass(/line-numbers-hidden/);
        await expect(creatorInner).not.toHaveClass(/authorColors/);

        await goToNewPad(page);
        await showSettings(page);
        await expect(page.locator('#options-linenoscheck')).not.toBeChecked();
        await expect(page.locator('#options-colorscheck')).not.toBeChecked();
      });

  test('disabling chat suppresses chat gritter notifications', async ({page, browser}) => {
    const padId = await goToNewPad(page);
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await goToPad(page2, padId);

    await showSettings(page);
    await page.locator('label[for="options-disablechat"]').click();
    await expect(page.locator('#options-disablechat')).toBeChecked();
    await expect(page.locator('#chaticon')).toBeHidden();

    await showChat(page2);
    await sendChatMessage(page2, 'hello from user 2');
    await expect(page.locator('.chat-gritter-msg')).toHaveCount(0);

    await context2.close();
  });
});
