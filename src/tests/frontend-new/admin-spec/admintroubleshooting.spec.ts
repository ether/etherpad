import {expect, test} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper.js";

// Admin tests observe global server state (installed plugins, hooks,
// settings). Run serially so a parallel test's mutation can't leak in.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page })=>{
  await loginToAdmin(page, 'admin', 'changeme1');
  await page.goto('http://localhost:9001/admin/help')
})

test('Shows troubleshooting page manager', async ({page}) => {
  await page.goto('http://localhost:9001/admin/help')
  await page.waitForSelector('.menu')
  const menu =  page.locator('.menu');
  // Sidebar nav: plugins, settings, help, pads, shout, update.
  // The Authors link only renders when gdprAuthorErasure.enabled = true,
  // which the test environment leaves false by default.
  await expect(menu.locator('.sidebar-nav-item')).toHaveCount(6);
})

test('Shows a version number', async function ({page}) {
  await page.goto('http://localhost:9001/admin/help')
  await page.waitForSelector('.pm-hv-num')
  const version = (await page.locator('.pm-hv-num').textContent())!.split('.');
  expect(version.length).toBe(3)
});

test('Lists installed parts', async function ({page}) {
  await page.goto('http://localhost:9001/admin/help')
  await page.waitForSelector('.pm-tag-cloud')
  // First tag cloud = installed plugins, second = installed parts
  const parts = page.locator('.pm-tag-cloud').nth(1);
  expect(await parts.textContent()).toContain('ep_etherpad-lite/adminsettings');
});

test('Lists installed hooks', async function ({page}) {
  await page.goto('http://localhost:9001/admin/help')
  await page.waitForSelector('.pm-hooks')
  const hooks = page.locator('.pm-hooks');
  expect(await hooks.textContent()).toContain('express');
});
