import {expect, Page, test} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper";

// #8246: the admin catalog used to offer every package in the plugin feed,
// including ones that are known to break a working Etherpad. ep_adminpads2 is
// the reported case — it installs cleanly, then takes over /admin/pads with a
// template whose scripts core no longer ships. The two assertions below are
// deliberately paired: the catalog must drop the broken plugin *and* keep
// listing the healthy ones, because a filter that empties the catalog would
// be a worse bug than the one it fixes.
test.describe('Plugin catalog hygiene', () => {
    test.beforeEach(async ({page}) => {
        await loginToAdmin(page, 'admin', 'changeme1');
        await page.goto('http://localhost:9001/admin/plugins');
        await page.waitForSelector('.pm-search-input');
    });

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

// Picking a sort field starts it in the direction people expect: names A to Z,
// versions and "Last updated" highest/newest first. The live feed changes
// daily, so the search results are replaced with a fixture on the socket.
const NS = '/pluginfw/installer';
const PREFIX = `42${NS},`;

const sortFixture = [
    {name: 'ep_sort_b', description: 'b', version: '9.0.0', time: '2026-01-15'},
    {name: 'ep_sort_a', description: 'a', version: '10.0.0', time: '2026-11-20'},
    {name: 'ep_sort_d', description: 'd', version: '11.0.0', time: ''},
    {name: 'ep_sort_c', description: 'c', version: '2.0.0', time: '2025-06-01'},
];

const useSortFixture = async (page: Page) => {
    await page.routeWebSocket(/\/socket\.io\//, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((msg) => server.send(msg));
        server.onMessage((msg) => {
            if (typeof msg === 'string' && msg.startsWith(PREFIX)) {
                const m = /^(\d*)(\[[\s\S]*)$/.exec(msg.slice(PREFIX.length));
                const payload = m && JSON.parse(m[2]);
                if (payload && payload[0] === 'results:search') {
                    payload[1].results = sortFixture;
                    ws.send(`${PREFIX}${m![1]}${JSON.stringify(payload)}`);
                    return;
                }
            }
            ws.send(msg);
        });
    });
};

const names = (page: Page) => page.locator('table tbody tr').evaluateAll(
    (rows) => rows.map((r) => (r.textContent || '').match(/ep_sort_[a-z]/)?.[0]));

test.describe('Plugin catalog sorting', () => {
    test.beforeEach(async ({page}) => {
        await useSortFixture(page);
        await loginToAdmin(page, 'admin', 'changeme1');
        await page.goto('http://localhost:9001/admin/plugins');
        await page.waitForSelector('.pm-search-input');
        await expect(page.locator('table tbody tr')).toHaveCount(sortFixture.length, {timeout: 30000});
    });

    test('name sorts A to Z by default', async ({page}) => {
        await expect.poll(() => names(page))
            .toEqual(['ep_sort_a', 'ep_sort_b', 'ep_sort_c', 'ep_sort_d']);
        await expect(page.locator('.pm-sort-dir')).toHaveText('↑');
    });

    test('last updated shows newest first, undated last, and the toggle reverses it', async ({page}) => {
        await page.locator('select.pm-select').selectOption('last-updated');
        await expect(page.locator('.pm-sort-dir')).toHaveText('↓');
        await expect(page.locator('.pm-sort-dir')).toHaveAttribute('title', 'Sort descending');
        await expect.poll(() => names(page))
            .toEqual(['ep_sort_a', 'ep_sort_b', 'ep_sort_c', 'ep_sort_d']);

        await page.locator('.pm-sort-dir').click();
        await expect(page.locator('.pm-sort-dir')).toHaveText('↑');
        await expect.poll(() => names(page))
            .toEqual(['ep_sort_c', 'ep_sort_b', 'ep_sort_a', 'ep_sort_d']);
    });

    test('version shows highest first, compared numerically', async ({page}) => {
        await page.locator('select.pm-select').selectOption('version');
        await expect(page.locator('.pm-sort-dir')).toHaveText('↓');
        await expect.poll(() => names(page))
            .toEqual(['ep_sort_d', 'ep_sort_a', 'ep_sort_b', 'ep_sort_c']);

        await page.locator('select.pm-select').selectOption('name');
        await expect(page.locator('.pm-sort-dir')).toHaveText('↑');
    });
});
