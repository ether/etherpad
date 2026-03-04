import {Page} from "@playwright/test";

export const isSettingsShown = async (page: Page) => {
    const classes = await page.locator('#settings').getAttribute('class')
    return classes && classes.includes('popup-show')
}


export const showSettings = async (page: Page) => {
    if(await isSettingsShown(page)) return
    await page.locator("button[data-l10n-id='pad.toolbar.settings.title']").click()
    await page.waitForFunction(`document.querySelector('#settings').classList.contains('popup-show')`)
}

export const hideSettings = async (page: Page) => {
    if(!await isSettingsShown(page)) return
    await page.locator("button[data-l10n-id='pad.toolbar.settings.title']").click()
    await page.waitForFunction(`!document.querySelector('#settings').classList.contains('popup-show')`)
}

export const enableStickyChatviaSettings = async (page: Page) => {
    const stickyChat = page.locator('#options-stickychat')
    const checked = await stickyChat.isChecked()
    if(checked) return
    await stickyChat.check({force: true})
    await page.waitForSelector('#options-stickychat:checked')
}

export const disableStickyChat = async (page: Page) => {
    const stickyChat = page.locator('#options-stickychat')
    const checked = await stickyChat.isChecked()
    if(!checked) return
    await stickyChat.uncheck({force: true})
    await page.waitForSelector('#options-stickychat:not(:checked)')
}
