import {Frame, Locator, Page} from "@playwright/test";
import {MapArrayType} from "../../../node/types/MapType";
import {randomUUID} from "node:crypto";

export const getPadOuter =  async (page: Page): Promise<Frame> => {
    return page.frame('ace_outer')!;
}

export const getPadBody =  async (page: Page): Promise<Locator> => {
    return page.frame('ace_inner')!.locator('#innerdocbody')
}

export const selectAllText = async (page: Page) => {
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
}

export const toggleUserList = async (page: Page) => {
    await page.locator("button[data-l10n-id='pad.toolbar.showusers.title']").click()
}

export const setUserName = async (page: Page, userName: string) => {
    await page.waitForSelector('[class="popup popup-show"]')
    await page.click("input[data-l10n-id='pad.userlist.entername']");
    await page.keyboard.type(userName);
}


export const showChat = async (page: Page) => {
    const chatIcon = page.locator("#chaticon")
    const classes = await chatIcon.getAttribute('class')
    if (classes && !classes.includes('visible')) return
    await chatIcon.click()
    await page.waitForFunction(`!document.querySelector('#chaticon').classList.contains('visible')`)
}

export const getCurrentChatMessageCount = async (page: Page) => {
    return await page.locator('#chattext').locator('p').count()
}

export const getChatUserName = async (page: Page) => {
    return await page.locator('#chattext')
        .locator('p')
        .locator('b')
        .innerText()
}

export const getChatMessage = async (page: Page) => {
    return (await page.locator('#chattext')
        .locator('p')
        .textContent({}))!
        .split(await getChatTime(page))[1]

}


export const getChatTime = async (page: Page) => {
    return await page.locator('#chattext')
        .locator('p')
        .locator('.time')
        .innerText()
}

export const sendChatMessage = async (page: Page, message: string) => {
    let currentChatCount = await getCurrentChatMessageCount(page)

    const chatInput = page.locator('#chatinput')
    await chatInput.click()
    await page.keyboard.type(message)
    await page.keyboard.press('Enter')
    if(message === "") return
    await page.waitForFunction(`document.querySelector('#chattext').querySelectorAll('p').length >${currentChatCount}`)
}

export const isChatBoxShown = async (page: Page):Promise<boolean> => {
    const classes = await page.locator('#chatbox').getAttribute('class')
    return classes !==null && classes.includes('visible')
}

export const isChatBoxSticky = async (page: Page):Promise<boolean> => {
    const classes = await page.locator('#chatbox').getAttribute('class')
    console.log('Chat', classes && classes.includes('stickyChat'))
    return classes !==null && classes.includes('stickyChat')
}

export const hideChat = async (page: Page) => {
    if(!await isChatBoxShown(page)|| await isChatBoxSticky(page)) return
    await page.locator('#titlecross').click()
    await page.waitForFunction(`!document.querySelector('#chatbox').classList.contains('stickyChat')`)

}

export const enableStickyChatviaIcon = async (page: Page) => {
    if(await isChatBoxSticky(page)) return
    await page.locator('#titlesticky').click()
    await page.waitForFunction(`document.querySelector('#chatbox').classList.contains('stickyChat')`)
}

export const disableStickyChatviaIcon = async (page: Page) => {
    if(!await isChatBoxSticky(page)) return
    await page.locator('#titlecross').click()
    await page.waitForFunction(`!document.querySelector('#chatbox').classList.contains('stickyChat')`)
}


export const appendQueryParams = async (page: Page, queryParameters: MapArrayType<string>) => {
    const searchParams = new URLSearchParams(page.url().split('?')[1]);
    Object.keys(queryParameters).forEach((key) => {
        searchParams.append(key, queryParameters[key]);
    });
    await page.goto(page.url()+"?"+ searchParams.toString());
    await page.waitForSelector('iframe[name="ace_outer"]');
}

export const goToNewPad = async (page: Page) => {
    // create a new pad before each test run
    const padId = "FRONTEND_TESTS"+randomUUID();
    await page.goto('http://localhost:9001/p/'+padId);
    await page.waitForSelector('iframe[name="ace_outer"]');
    return padId;
}

export const goToPad = async (page: Page, padId: string) => {
    await page.goto('http://localhost:9001/p/'+padId);
    await page.waitForSelector('iframe[name="ace_outer"]');
}


export const clearPadContent = async (page: Page) => {
    const body = await getPadBody(page);
    await body.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Delete');
}

export const writeToPad = async (page: Page, text: string) => {
    const body = await getPadBody(page);
    await body.click();
    await page.keyboard.type(text);
}

export const clearAuthorship = async (page: Page) => {
    await page.locator("button[data-l10n-id='pad.toolbar.clearAuthorship.title']").click()
}

export const undoChanges = async (page: Page) => {
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');
}

export const pressUndoButton = async (page: Page) => {
    await page.locator('.buttonicon-undo').click()
}
