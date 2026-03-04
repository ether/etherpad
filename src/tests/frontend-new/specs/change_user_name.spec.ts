import {expect, test} from "@playwright/test";
import {randomInt} from "node:crypto";
import {goToNewPad, sendChatMessage, setUserName, showChat, toggleUserList} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
    // create a new pad before each test run
    await goToNewPad(page);
})


test("Remembers the username after a refresh", async ({page}) => {
    await toggleUserList(page);
    await setUserName(page,'😃')
    await toggleUserList(page)

    await page.reload();
    await toggleUserList(page);
    const usernameField = page.locator("input[data-l10n-id='pad.userlist.entername']");
    await expect(usernameField).toHaveValue('😃');
})


test('Own user name is shown when you enter a chat', async ({page})=> {
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
