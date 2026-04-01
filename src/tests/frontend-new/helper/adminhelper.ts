import {expect, Page} from "@playwright/test";

export const loginToAdmin = async (page: Page, username: string, password: string) => {

  await page.goto('http://localhost:9001/admin/login');

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
  await expect(settings).not.toHaveValue('', {timeout: 30000});
  await expect(restartButton).toBeVisible({timeout: 10000})
  await restartButton.click()
  // Wait for the server to come back up by polling.
  // The server needs time to shut down and restart, so poll with longer intervals.
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000)
    try {
      const response = await page.goto('http://localhost:9001/', {timeout: 5000})
      if (response && response.status() === 200) return;
    } catch {
      // connection refused or timeout — server still restarting
    }
  }
  throw new Error('Etherpad did not restart within 60 seconds');
}
