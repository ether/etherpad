import {expect, test} from "@playwright/test";
import {loginToAdmin, restartEtherpad, saveSettings} from "../helper/adminhelper";

// Settings tests mutate and restart the server. Run serially so restarts
// don't collide with parallel tests reading/writing the same settings.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page })=>{
  await loginToAdmin(page, 'admin', 'changeme1');
})

test.describe('admin settings',()=> {


  test('Are Settings visible, populated, does save work', async ({page}) => {
    await page.goto('http://localhost:9001/admin/settings');
    await page.waitForSelector('.settings');
    const settings =  page.locator('.settings');
    await expect(settings).not.toHaveValue('', {timeout: 30000});

    const settingsVal = await settings.inputValue()
    const settingsLength = settingsVal.length

    await settings.fill(`{"title": "Etherpad123"}`)
    const newValue = await settings.inputValue()
    expect(newValue).toContain('{"title": "Etherpad123"}')
    expect(newValue.length).toEqual(24)
    await saveSettings(page)

    // Check if the changes were actually saved
    await page.reload()
    await page.waitForSelector('.settings');
    await expect(settings).not.toHaveValue('', {timeout: 30000});

    const newSettings =  page.locator('.settings');

    const newSettingsVal = await newSettings.inputValue()
    expect(newSettingsVal).toContain('{"title": "Etherpad123"}')


    // Change back to old settings
    await newSettings.fill(settingsVal)
    await saveSettings(page)

    await page.reload()
    await page.waitForSelector('.settings');
    await expect(settings).not.toHaveValue('', {timeout: 30000});
    const oldSettings =  page.locator('.settings');
    const oldSettingsVal = await oldSettings.inputValue()
    expect(oldSettingsVal).toEqual(settingsVal)
    expect(oldSettingsVal.length).toEqual(settingsLength)
  })

  test('restart works', async function ({page}) {
    await page.goto('http://localhost:9001/admin/settings');
    await page.waitForSelector('.settings')
    await restartEtherpad(page)
    // Re-login after restart since session is lost
    await loginToAdmin(page, 'admin', 'changeme1')
    await page.goto('http://localhost:9001/admin/settings');
    await page.waitForSelector('.settings')
    const settings =  page.locator('.settings');
    await expect(settings).not.toHaveValue('', {timeout: 30000});
  });
})
