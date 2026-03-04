import {expect, Page} from "@playwright/test";

export const loginToAdmin = async (page: Page, username: string, password: string) => {

    await page.goto('http://localhost:9001/admin/');

    await page.waitForSelector('input[name="username"]');
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);
    await page.click('input[type="submit"]');
}


export const saveSettings = async (page: Page) => {
    // Click save
    await page.locator('.settings-button-bar').locator('button').first().click()
    await page.waitForSelector('.ToastRootSuccess')
}

export const restartEtherpad = async (page: Page) => {
    // Click restart
    const restartButton = page.locator('.settings-button-bar').locator('.settingsButton').nth(1)
    const settings =  page.locator('.settings');
    await expect(settings).not.toBeEmpty();
    await expect(restartButton).toBeVisible()
    await page.locator('.settings-button-bar')
        .locator('.settingsButton')
        .nth(1)
        .click()
    await page.waitForTimeout(500)
    await page.waitForSelector('.settings')
}
