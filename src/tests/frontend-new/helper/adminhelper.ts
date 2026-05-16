import {expect, Page} from "@playwright/test";

export const loginToAdmin = async (page: Page, username: string, password: string) => {

  await page.goto('http://localhost:9001/admin/login');

  await page.waitForSelector('input[name="username"]');
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('input[type="submit"]');
}


export const saveSettings = async (page: Page) => {
  // If a success toast is already open (from a previous save), wait for it to
  // close first so we don't mistake the stale open state for the new ack.
  // Radix Toast toggles data-state rather than removing the element.
  const existing = page.locator('.ToastRootSuccess[data-state="open"]');
  if (await existing.count() > 0) {
    await existing.waitFor({state: 'hidden'}).catch(() => {});
  }
  await page.getByTestId('save-settings-button').click();
  await page.waitForSelector('.ToastRootSuccess[data-state="open"]');
}

export const restartEtherpad = async (page: Page) => {
  const restartButton = page.getByTestId('restart-etherpad-button');
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
