import {expect, test} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper";

test.beforeEach(async ({ page })=>{
    await loginToAdmin(page, 'admin', 'changeme1');
    await page.goto('http://localhost:9001/admin/plugins')
})


test.describe('Plugins page',  ()=> {

    test('List some plugins', async ({page}) => {
        await page.waitForSelector('.search-field');
        const pluginTable =  page.locator('table tbody').nth(1);
        await expect(pluginTable).not.toBeEmpty()
    })

    test('Searches for a plugin', async ({page}) => {
        await page.waitForSelector('.search-field');
        await page.click('.search-field')
        await page.keyboard.type('ep_font_color')
        await page.keyboard.press('Enter')
        const pluginTable =  page.locator('table tbody').nth(1);
        await expect(pluginTable.locator('tr')).toHaveCount(1)
        await expect(pluginTable.locator('tr').first()).toContainText('ep_font_color')
    })


    test('Attempt to Install and Uninstall a plugin', async ({page}) => {
        await page.waitForSelector('.search-field');
        const pluginTable =  page.locator('table tbody').nth(1);
        await expect(pluginTable).not.toBeEmpty({
            timeout: 15000
        })

        // Now everything is loaded, lets install a plugin

        await page.click('.search-field')
        await page.keyboard.type('ep_font_color')
        await page.keyboard.press('Enter')

        await expect(pluginTable.locator('tr')).toHaveCount(1)
        const pluginRow = pluginTable.locator('tr').first()
        await expect(pluginRow).toContainText('ep_font_color')

        // Select Installation button
        await pluginRow.locator('td').nth(4).locator('button').first().click()
        await page.waitForTimeout(100)
        await page.waitForSelector('table tbody')
        const installedPlugins = page.locator('table tbody').first()
        const installedPluginsRows = installedPlugins.locator('tr')
        await expect(installedPluginsRows).toHaveCount(2, {
            timeout: 15000
        })

        const installedPluginRow = installedPluginsRows.nth(1)

        await expect(installedPluginRow).toContainText('ep_font_color')
        await installedPluginRow.locator('td').nth(2).locator('button').first().click()

        // Wait for the uninstallation to complete
        await expect(installedPluginsRows).toHaveCount(1, {
            timeout: 15000
        })
        await page.waitForTimeout(5000)
    })
})


/*
  it('Attempt to Update a plugin', async function () {
    this.timeout(280000);

    await helper.waitForPromise(() => helper.admin$('.results').children().length > 50, 20000);

    if (helper.admin$('.ep_align').length === 0) this.skip();

    await helper.waitForPromise(
        () => helper.admin$('.ep_align .version').text().split('.').length >= 2);

    const minorVersionBefore =
        parseInt(helper.admin$('.ep_align .version').text().split('.')[1]);

    if (!minorVersionBefore) {
      throw new Error('Unable to get minor number of plugin, is the plugin installed?');
    }

    if (minorVersionBefore !== 2) this.skip();

    helper.waitForPromise(
        () => helper.admin$('.ep_align .do-update').length === 1);

    await timeout(500); // HACK!  Please submit better fix..
    const $doUpdateButton = helper.admin$('.ep_align .do-update');
    $doUpdateButton.trigger('click');

    // ensure its showing as Updating
    await helper.waitForPromise(
        () => helper.admin$('.ep_align .message').text() === 'Updating');

    // Ensure it's a higher minor version IE 0.3.x as 0.2.x was installed
    // Coverage for https://github.com/ether/etherpad-lite/issues/4536
    await helper.waitForPromise(() => parseInt(helper.admin$('.ep_align .version')
        .text()
        .split('.')[1]) > minorVersionBefore, 60000, 1000);
    // allow 50 seconds, check every 1 second.
  });
 */
