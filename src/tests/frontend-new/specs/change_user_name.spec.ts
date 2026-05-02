import {expect, test} from "@playwright/test";
import {randomInt} from "node:crypto";
import {goToNewPad, sendChatMessage, setUserName, showChat, toggleUserList} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
  // create a new pad before each test run
  await goToNewPad(page);
})


test("Remembers the username after a refresh", {
  tag: '@feature:username',
}, async ({page}) => {
  await toggleUserList(page);
  await setUserName(page,'😃')
  await toggleUserList(page)

  await page.reload();
  await toggleUserList(page);
  const usernameField = page.locator("input[data-l10n-id='pad.userlist.entername']");
  await expect(usernameField).toHaveValue('😃');
})


test('Own user name is shown when you enter a chat', {
  tag: ['@feature:chat', '@feature:username'],
}, async ({page})=> {
  const chatMessage = 'O hi';

  await toggleUserList(page);
  await setUserName(page,'😃');
  await toggleUserList(page);

  await showChat(page);
  await sendChatMessage(page,chatMessage);
  const chatText = await page.locator('#chattext').locator('p').innerText();
  expect(chatText).toContain('😃')
  expect(chatText).toContain(chatMessage)
});

// #7593 review: the previous fix capped #myusernameform at 75px so a plugin-
// supplied "Log out" button wouldn't overflow, but vanilla etherpad-lite has
// no such button and the cap just made the username field too small. The
// colibris skin also pre-existing override of margin-left:35px (chosen for
// the chatAndUsers sticky layout) has been aligned with the base 10px.
test('#myusernameform has 10px left margin and is not width-capped', {
  tag: '@feature:username',
}, async ({page}) => {
  await toggleUserList(page);

  const styles = await page.evaluate(() => {
    const form = document.querySelector('#myusernameform') as HTMLElement;
    const input = document.querySelector('#myusernameedit') as HTMLElement;
    return {
      formMarginLeft: getComputedStyle(form).marginLeft,
      formWidth: getComputedStyle(form).width,
      inputWidth: getComputedStyle(input).width,
    };
  });

  expect(styles.formMarginLeft).toBe('10px');
  // The form should size to its content / parent flex behaviour, NOT be capped
  // at 75px — width should comfortably exceed that.
  expect(parseFloat(styles.formWidth)).toBeGreaterThan(80);
  expect(parseFloat(styles.inputWidth)).toBeGreaterThan(80);
});
