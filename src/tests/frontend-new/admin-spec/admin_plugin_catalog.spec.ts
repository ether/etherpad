import {expect, test} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper";

// #8246: the admin catalog used to offer every package in the plugin feed,
// including ones that are known to break a working Etherpad. ep_adminpads2 is
// the reported case — it installs cleanly, then takes over /admin/pads with a
// template whose scripts core no longer ships. The two assertions below are
// deliberately paired: the catalog must drop the broken plugin *and* keep
// listing the healthy ones, because a filter that empties the catalog would
// be a worse bug than the one it fixes.
test.beforeEach(async ({page}) => {
    await loginToAdmin(page, 'admin', 'changeme1');
    await page.goto('http://localhost:9001/admin/plugins');
    await page.waitForSelector('.pm-search-input');
});

test.describe('Plugin catalog hygiene', () => {
    test('does not offer ep_adminpads2, which breaks the admin UI', async ({page}) => {
        const pluginTable = page.locator('table tbody').first();
        await expect(pluginTable).not.toBeEmpty({timeout: 60000});

        await page.click('.pm-search-input');
        await page.keyboard.type('adminpads');
        // The search is debounced client-side; wait for the list to settle on
        // the filtered result before asserting on its contents.
        await expect(pluginTable).toContainText('ep_adminpads', {timeout: 60000});
        await expect(pluginTable).not.toContainText('ep_adminpads2');
    });

    test('still offers a healthy plugin', async ({page}) => {
        const pluginTable = page.locator('table tbody').first();
        await expect(pluginTable).not.toBeEmpty({timeout: 60000});

        await page.click('.pm-search-input');
        await page.keyboard.type('ep_align');
        await expect(pluginTable.locator('tr').first())
            .toContainText('ep_align', {timeout: 60000});
    });
});
