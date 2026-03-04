import {expect, test} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper";

test.beforeEach(async ({ page })=>{
    await loginToAdmin(page, 'admin', 'changeme1');
    await page.goto('http://localhost:9001/admin/help')
})

test('Shows troubleshooting page manager', async ({page}) => {
    await page.goto('http://localhost:9001/admin/help')
    await page.waitForSelector('.menu')
    const menu =  page.locator('.menu');
    await expect(menu.locator('li')).toHaveCount(5);
})

test('Shows a version number', async function ({page}) {
    await page.goto('http://localhost:9001/admin/help')
    await page.waitForSelector('.menu')
    const helper = page.locator('.help-block').locator('div').nth(1)
    const version = (await helper.textContent())!.split('.');
    expect(version.length).toBe(3)
});

test('Lists installed parts', async function ({page}) {
    await page.goto('http://localhost:9001/admin/help')
    await page.waitForSelector('.menu')
    await page.waitForSelector('.innerwrapper ul')
    const parts = page.locator('.innerwrapper ul').nth(1);
    expect(await parts.textContent()).toContain('ep_etherpad-lite/adminsettings');
});

test('Lists installed hooks', async function ({page}) {
    await page.goto('http://localhost:9001/admin/help')
    await page.waitForSelector('.menu')
    await page.waitForSelector('.innerwrapper ul')
    const helper = page.locator('.innerwrapper ul').nth(2);
    expect(await helper.textContent()).toContain('express');
});

