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


test.beforeEach(async ({ page })=>{
    await goToNewPad(page);
})


test('opens chat, sends a message, makes sure it exists on the page and hides chat', async ({page}) => {
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

test("makes sure that an empty message can't be sent", async function ({page}) {
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

test('makes chat stick to right side of the screen via settings, remove sticky via settings, close it', async ({page}) =>{
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
    'remove sticky via icon, close it', async function ({page}) {
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
    ' when removed it shows chat', async function ({page}) {

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
