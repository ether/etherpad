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

    await expect(page.locator('#user-settings-section > h2')).toHaveText('User Settings');
    await expect(page.locator('#pad-settings-section > h2')).toHaveText('Pad-wide Settings');
    await expect(page.locator('#theme-toggle-row')).toBeVisible();
    await expect(page.locator('#pad-settings-section')).toBeVisible();
    await expect(page.locator('#delete-pad')).toBeVisible();
    await expect(page.locator('#padsettings-enforcecheck')).toBeVisible();

    await expect(page2.locator('#user-settings-section > h2')).toHaveText('User Settings');
    await expect(page2.locator('#theme-toggle-row')).toBeVisible();
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
    await expect(page.locator('#options-linenoscheck')).toBeEnabled();
    await expect(page.locator('#options-colorscheck')).toBeEnabled();
    await expect(page2.locator('#enforce-settings-notice')).toBeVisible();
    await expect(page.locator('#enforce-settings-notice')).toBeHidden();
    await context2.close();
  });

  test('creator can keep authorship colors while pad-wide enforced settings keep them off for other users',
      async ({page, browser}) => {
        const padId = await goToNewPad(page);

        const context2 = await browser.newContext();
        const page2 = await context2.newPage();
        await goToPad(page2, padId);

        const creatorInner = page.frameLocator('iframe[name="ace_outer"]')
          .frameLocator('iframe[name="ace_inner"]').locator('body');
        const viewerInner = page2.frameLocator('iframe[name="ace_outer"]')
          .frameLocator('iframe[name="ace_inner"]').locator('body');

        await expect(creatorInner).toHaveClass(/authorColors/);
        await expect(viewerInner).toHaveClass(/authorColors/);

        await showSettings(page);
        await page.locator('label[for="padsettings-options-colorscheck"]').click();
        await expect(page.locator('#padsettings-options-colorscheck')).not.toBeChecked();
        await expect(page.locator('#options-colorscheck')).not.toBeChecked();
        await expect(creatorInner).not.toHaveClass(/authorColors/);
        await expect(viewerInner).not.toHaveClass(/authorColors/);

        await page.locator('label[for="padsettings-enforcecheck"]').click();
        await expect(page.locator('#padsettings-enforcecheck')).toBeChecked();
        await showSettings(page2);
        await expect(page2.locator('#enforce-settings-notice')).toBeVisible();
        await expect(page.locator('#enforce-settings-notice')).toBeHidden();

        await page.locator('label[for="options-colorscheck"]').click();
        await expect(page.locator('#options-colorscheck')).toBeChecked();
        await expect(creatorInner).toHaveClass(/authorColors/);
        await expect(viewerInner).not.toHaveClass(/authorColors/);

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

  // #7592: ticking "Disable chat" must visibly disable the dependent
  // "Chat always on screen" / "Show Chat and Users" toggles, not just
  // make the underlying inputs non-interactive.
  test('disabling chat disables and visually greys the dependent chat toggles', async ({page}) => {
    await goToNewPad(page);
    await showSettings(page);

    // Initial state: dependent toggles are interactive.
    await expect(page.locator('#options-stickychat')).toBeEnabled();
    await expect(page.locator('#options-chatandusers')).toBeEnabled();

    await page.locator('label[for="options-disablechat"]').click();
    await expect(page.locator('#options-disablechat')).toBeChecked();

    // Inputs become disabled (refreshMyViewControls in pad.ts).
    await expect(page.locator('#options-stickychat')).toBeDisabled();
    await expect(page.locator('#options-chatandusers')).toBeDisabled();

    // Colibris toggle visualisation dims via opacity:.4 on the label
    // (covers the hidden checkbox + before/after pseudo-elements).
    const stickyLabelOpacity = await page.evaluate(
        () => getComputedStyle(document.querySelector('label[for="options-stickychat"]')!).opacity);
    const chatAndUsersLabelOpacity = await page.evaluate(
        () => getComputedStyle(document.querySelector('label[for="options-chatandusers"]')!).opacity);
    expect(parseFloat(stickyLabelOpacity)).toBeLessThan(1);
    expect(parseFloat(chatAndUsersLabelOpacity)).toBeLessThan(1);

    // Untick "Disable chat" → dependent toggles are interactive again.
    await page.locator('label[for="options-disablechat"]').click();
    await expect(page.locator('#options-disablechat')).not.toBeChecked();
    await expect(page.locator('#options-stickychat')).toBeEnabled();
    await expect(page.locator('#options-chatandusers')).toBeEnabled();
  });
});
