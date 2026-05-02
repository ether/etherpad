import {expect, test} from "@playwright/test";
import {randomInt} from "node:crypto";
import {
  appendQueryParams,
  disableStickyChatviaIcon,
  enableStickyChatviaIcon,
  getChatMessage,
  getChatTime,
  getChatUserName,
  getCurrentChatMessageCount, goToNewPad, hideChat, isChatBoxShown, isChatBoxSticky,
  sendChatMessage,
  showChat,
} from "../helper/padHelper";
import {disableStickyChat, enableStickyChatviaSettings, hideSettings, showSettings} from "../helper/settingsHelper";


test.beforeEach(async ({ page, context })=>{
  await context.clearCookies();
  await goToNewPad(page);
})


test('opens chat, sends a message, makes sure it exists on the page and hides chat', {
  tag: '@feature:chat',
}, async ({page}) => {
  const chatValue = "JohnMcLear"

  // Open chat
  await showChat(page);
  await sendChatMessage(page, chatValue);

  expect(await getCurrentChatMessageCount(page)).toBe(1);
  const username = await getChatUserName(page)
  const time = await getChatTime(page)
  const chatMessage = await getChatMessage(page)

  expect(username).toBe('unnamed:');
  const regex = new RegExp('^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$');
  expect(time).toMatch(regex);
  expect(chatMessage).toBe(" "+chatValue);
})

test("makes sure that an empty message can't be sent", {
  tag: '@feature:chat',
}, async function ({page}) {
  const chatValue = 'mluto';

  await showChat(page);

  await sendChatMessage(page,"");
  // Send a message
  await sendChatMessage(page,chatValue);

  expect(await getCurrentChatMessageCount(page)).toBe(1);

  // check that the received message is not the empty one
  const username = await getChatUserName(page)
  const time = await getChatTime(page);
  const chatMessage = await getChatMessage(page);

  expect(username).toBe('unnamed:');
  const regex = new RegExp('^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$');
  expect(time).toMatch(regex);
  expect(chatMessage).toBe(" "+chatValue);
});

test('makes chat stick to right side of the screen via settings, remove sticky via settings, close it', {
  tag: '@feature:chat',
}, async ({page}) =>{
  await showSettings(page);

  await enableStickyChatviaSettings(page);
  expect(await isChatBoxShown(page)).toBe(true);
  expect(await isChatBoxSticky(page)).toBe(true);

  await disableStickyChat(page);
  expect(await isChatBoxShown(page)).toBe(true);
  expect(await isChatBoxSticky(page)).toBe(false);
  await hideSettings(page);
  await hideChat(page);
  expect(await isChatBoxShown(page)).toBe(false);
  expect(await isChatBoxSticky(page)).toBe(false);
});

test('makes chat stick to right side of the screen via icon on the top right, ' +
  'remove sticky via icon, close it', {
  tag: '@feature:chat',
}, async function ({page}) {
  await showChat(page);

  await enableStickyChatviaIcon(page);
  expect(await isChatBoxShown(page)).toBe(true);
  expect(await isChatBoxSticky(page)).toBe(true);

  await disableStickyChatviaIcon(page);
  expect(await isChatBoxShown(page)).toBe(true);
  expect(await isChatBoxSticky(page)).toBe(false);

  await hideChat(page);
  expect(await isChatBoxSticky(page)).toBe(false);
  expect(await isChatBoxShown(page)).toBe(false);
});


test('Checks showChat=false URL Parameter hides chat then' +
  ' when removed it shows chat', {
  tag: '@feature:chat',
}, async function ({page}) {

  // get a new pad, but don't clear the cookies
  await appendQueryParams(page, {
    showChat: 'false'
  });

  const chaticon = page.locator('#chaticon')


  // chat should be hidden.
  expect(await chaticon.isVisible()).toBe(false);

  // get a new pad, but don't clear the cookies
  await goToNewPad(page);
  const secondChatIcon = page.locator('#chaticon')

  // chat should be visible.
  expect(await secondChatIcon.isVisible()).toBe(true)
});

// Regression: applyShowChat(false) sets inline `display: none` on #chatbox via
// jQuery .hide(); re-enabling chat doesn't undo it, and chat.show() only flips
// visibility via the .visible class — so without an explicit display reset the
// box stays hidden by the lingering inline style. (PR #7597)
test('chat icon click reveals chatbox after a disable → enable cycle', {
  tag: '@feature:chat',
}, async ({page}) => {
  await showSettings(page);
  await page.locator('label[for="options-disablechat"]').click();
  await expect(page.locator('#options-disablechat')).toBeChecked();
  await expect(page.locator('#chaticon')).toBeHidden();

  await page.locator('label[for="options-disablechat"]').click();
  await expect(page.locator('#options-disablechat')).not.toBeChecked();
  await expect(page.locator('#chaticon')).toBeVisible();
  await hideSettings(page);

  await showChat(page);
  await expect(page.locator('#chatbox')).toBeVisible();
  await expect(page.locator('#chatbox')).toHaveClass(/visible/);
});

// Title-bar layout / glyph regressions from #7590 review.
test('chat title bar lays out as a centred flex row with underscore minimize', {
  tag: '@feature:chat',
}, async ({page}) => {
  await showChat(page);

  // Minimize button uses an underscore (sits at the bottom of its em-box and
  // reads as a proper minimize indicator); it must not silently revert to
  // &minus; or a hyphen.
  await expect(page.locator('#titlecross')).toHaveText('_');

  const styles = await page.evaluate(() => {
    const cs = (sel: string) => getComputedStyle(document.querySelector(sel)!);
    const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    const tb = rect('#titlebar');
    const lab = rect('#titlelabel');
    const sticky = rect('#titlesticky');
    return {
      titlebarDisplay: cs('#titlebar').display,
      titlebarAlignItems: cs('#titlebar').alignItems,
      labelFlex: cs('#titlelabel').flexGrow,
      crossFloat: cs('#titlecross').float,
      crossTransform: cs('#titlecross').transform,
      stickyFloat: cs('#titlesticky').float,
      // Visual symmetry — CHAT's left edge sits roughly the same distance
      // from the title-bar left edge as the rightmost button sits from the
      // right edge. Tested via rendered geometry rather than CSS literal so
      // we don't get tripped up by skin overrides (colibris ships its own
      // #titlebar padding rule).
      leftGap: lab.left - tb.left,
      rightGap: tb.right - sticky.right,
    };
  });
  expect(styles.titlebarDisplay).toBe('flex');
  expect(styles.titlebarAlignItems).toBe('center');
  // Title takes the remaining width so corner buttons sit at the right edge.
  expect(styles.labelFlex).toBe('1');
  // Buttons are flex items, not floats — old `float: right` layout must stay gone.
  expect(styles.crossFloat).toBe('none');
  expect(styles.stickyFloat).toBe('none');
  // 5px lift on #titlecross so the `_` glyph reads near the title's baseline
  // rather than at the very bottom of the row.
  expect(styles.crossTransform).not.toBe('none');
  // Padding looks symmetric (within 2px to allow for sub-pixel rounding).
  expect(Math.abs(styles.leftGap - styles.rightGap)).toBeLessThanOrEqual(2);
});

// Regression: #chaticon was a <div> before the #7584 a11y refactor; once it
// became a <button>, the inner <span class="buttonicon"> being `display: flex`
// (from the global icons.css rule) could intercept clicks and the chat icon
// stopped opening the panel. The fix scopes a reset on `#chaticon .buttonicon`.
test('chat icon click reliably opens the chat box', {
  tag: '@feature:chat',
}, async ({page}) => {
  await expect(page.locator('#chaticon')).toBeVisible();
  await page.locator('#chaticon').click();
  await expect(page.locator('#chatbox')).toHaveClass(/visible/);
  await expect(page.locator('#chatbox')).toBeVisible();
});
