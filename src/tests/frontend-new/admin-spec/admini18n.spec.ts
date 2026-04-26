import {expect, test} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper.js";

// Regression coverage for https://github.com/ether/etherpad/issues/7586
//
// 2.7.0 shipped with the admin SPA's locale files copied to a wrong
// build path; fetches for them silently fell back to the SPA's
// index.html, JSON.parse failed, and every <Trans> rendered as its
// raw key. None of the existing admin specs asserted on translated
// strings, so the regression slipped through. We now bundle the
// translations through Vite (import.meta.glob) — these tests pin the
// rendered behaviour rather than the file path so any future
// loading-mechanism change is covered too.
test.beforeEach(async ({ page })=>{
  await loginToAdmin(page, 'admin', 'changeme1');
});

test.describe('admin i18n', () => {
  test('renders translated text on /admin (default English)', async ({page}) => {
    await page.goto('http://localhost:9001/admin/');
    // HomePage renders <h1><Trans i18nKey="admin_plugins"/></h1>. If
    // translations fail to load, the visible text becomes the raw key
    // "admin_plugins". Asserting on the translated form catches that.
    await expect(page.locator('h1', { hasText: /^Plugin manager$/ }))
        .toBeVisible({ timeout: 30000 });
    await expect(page.getByText('admin_plugins', { exact: true })).toHaveCount(0);
  });

  test('switches language to German via ?lng=de', async ({page}) => {
    await page.goto('http://localhost:9001/admin/?lng=de');
    await expect(page.locator('h1', { hasText: /^Pluginverwaltung$/ }))
        .toBeVisible({ timeout: 30000 });
  });
});
