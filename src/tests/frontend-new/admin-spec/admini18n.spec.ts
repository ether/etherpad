import {expect, test} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper";

// Regression coverage for https://github.com/ether/etherpad/issues/7586
//
// 2.7.0 shipped with the admin SPA's locale files copied to
// `src/templates/admin/src/locales/` instead of `src/templates/admin/locales/`.
// Fetches for `/admin/locales/<lang>.json` 404'd, the express SPA fallback
// served `index.html`, JSON.parse failed silently in the i18n loader, and
// every `<Trans>` rendered its raw key. None of the existing admin specs
// asserted on translated strings, so the regression slipped through.
test.beforeEach(async ({ page })=>{
  await loginToAdmin(page, 'admin', 'changeme1');
});

test.describe('admin i18n', () => {
  test('renders translated text on /admin (default English)', async ({page}) => {
    await page.goto('http://localhost:9001/admin/');
    // The HomePage renders <h1><Trans i18nKey="admin_plugins"/></h1>. If i18n
    // breaks, the visible text becomes the raw key "admin_plugins". Asserting
    // on the translated form catches that.
    await expect(page.locator('h1', { hasText: /^Plugin manager$/ }))
        .toBeVisible({ timeout: 30000 });
    await expect(page.getByText('admin_plugins', { exact: true })).toHaveCount(0);
  });

  test('switches language to German via ?lng=de', async ({page}) => {
    await page.goto('http://localhost:9001/admin/?lng=de');
    await expect(page.locator('h1', { hasText: /^Pluginverwaltung$/ }))
        .toBeVisible({ timeout: 30000 });
  });

  test('serves /admin/locales/<lang>.json as JSON, not the SPA fallback', async ({page}) => {
    // Direct fetch through the page so cookies/auth match the admin context.
    const responses = await Promise.all(['en', 'de'].map(async (lang) => {
      const resp = await page.request.get(`http://localhost:9001/admin/locales/${lang}.json`);
      return { lang, resp };
    }));
    for (const { lang, resp } of responses) {
      expect(resp.status(), `status for ${lang}`).toBe(200);
      const ct = resp.headers()['content-type'] || '';
      expect(ct, `content-type for ${lang}`).toMatch(/application\/json/i);
      const body = await resp.json();
      expect(typeof body, `body type for ${lang}`).toBe('object');
      expect(body['admin_plugins'], `admin_plugins for ${lang}`).toBeTruthy();
    }
  });
});
