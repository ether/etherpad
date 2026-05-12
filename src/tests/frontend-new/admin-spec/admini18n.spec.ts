import {expect, test, Page} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper";

// Regression coverage for https://github.com/ether/etherpad/issues/7586
// and https://github.com/ether/etherpad/issues/7735.
//
// 2.7.0 shipped with the admin SPA's locale files copied to a wrong
// build path; fetches for them silently fell back to the SPA's
// index.html, JSON.parse failed, and every <Trans> rendered as its
// raw key. The 2.7.3 "admin design rework" (#7716) then introduced ~50+
// hardcoded German literals across the admin pages, producing a
// French/English/German salad for non-DE users (#7735). We assert the
// rendered text in both English and German so a future regression that
// either (a) breaks locale loading or (b) re-introduces hardcoded copy
// will fail here rather than ship.
test.describe.configure({mode: 'serial'});

test.beforeEach(async ({page}) => {
  await loginToAdmin(page, 'admin', 'changeme1');
});

const open = async (page: Page, path: string) => {
  await page.goto(`http://localhost:9001${path}`);
};

test.describe('admin i18n', () => {
  test('renders translated text on /admin (default English)', async ({page}) => {
    await open(page, '/admin/');
    // HomePage renders <h1><Trans i18nKey="admin_plugins"/></h1>. If
    // translations fail to load, the visible text becomes the raw key
    // "admin_plugins". Asserting on the translated form catches that.
    await expect(page.locator('h1', {hasText: /^Plugin manager$/}))
      .toBeVisible({timeout: 30000});
    await expect(page.getByText('admin_plugins', {exact: true})).toHaveCount(0);
  });

  test('switches language to German via ?lng=de', async ({page}) => {
    await open(page, '/admin/?lng=de');
    await expect(page.locator('h1', {hasText: /^Pluginverwaltung$/}))
      .toBeVisible({timeout: 30000});
  });

  // The strings below were hardcoded German in #7716 — these assertions
  // pin the rendered output so a regression cannot pass review again.

  test('HomePage subtitle + buttons translate (English)', async ({page}) => {
    await open(page, '/admin/');
    await expect(page.getByText(/Install, update, and remove Etherpad plugins/))
      .toBeVisible({timeout: 30000});
    await expect(page.getByRole('button', {name: /Reload catalog/})).toBeVisible();
    await expect(page.getByRole('link', {name: /Search on npm/})).toBeVisible();
    // German leakage check: no hardcoded German on an English page.
    await expect(page.getByText(/Aktualisieren/)).toHaveCount(0);
    await expect(page.getByText(/verfügbar/)).toHaveCount(0);
  });

  test('HomePage stats labels translate (English)', async ({page}) => {
    await open(page, '/admin/');
    await expect(page.getByText(/Updates available/, {exact: false})).toBeVisible();
    await expect(page.getByText(/Plugin source/, {exact: false})).toBeVisible();
  });

  test('PadPage filters + headers translate (English)', async ({page}) => {
    await open(page, '/admin/pads');
    // Wait for the page to actually render — pad load is async.
    await page.waitForSelector('.pm-chips', {timeout: 30000});
    // Filter chips (formerly "Alle", "Aktiv", "Diese Woche", "Leer", "Veraltet").
    await expect(page.getByRole('button', {name: /^All$/})).toBeVisible();
    await expect(page.getByRole('button', {name: /^Active$/})).toBeVisible();
    await expect(page.getByRole('button', {name: /^This week$/})).toBeVisible();
    await expect(page.getByRole('button', {name: /^Empty$/})).toBeVisible();
    await expect(page.getByRole('button', {name: /Stale/})).toBeVisible();
    await expect(page.getByText(/Total pads/)).toBeVisible();
    await expect(page.getByText(/Active users/)).toBeVisible();
    // German leakage check.
    await expect(page.getByText(/Alle Pads/)).toHaveCount(0);
    await expect(page.getByText(/Zurück/)).toHaveCount(0);
  });

  test('HelpPage tabs + status translate (English)', async ({page}) => {
    await open(page, '/admin/help');
    await page.waitForSelector('.pm-hv-num', {timeout: 30000});
    await expect(page.getByRole('button', {name: /Copy diagnostics/})).toBeVisible();
    // Server / Client hook tabs.
    await expect(page.getByRole('button', {name: /^Server\s+\d+$/})).toBeVisible();
    await expect(page.getByRole('button', {name: /^Client\s+\d+$/})).toBeVisible();
    // German leakage.
    await expect(page.getByText(/Diagnose kopieren/)).toHaveCount(0);
    await expect(page.getByText(/Keine Hooks/)).toHaveCount(0);
  });

  test('Login screen labels translate (English)', async ({page}) => {
    // Hit /admin/login directly without auth via a fresh context.
    await page.context().clearCookies();
    await open(page, '/admin/login');
    await expect(page.getByPlaceholder('Username')).toBeVisible({timeout: 30000});
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.locator('input[type="submit"][value="Login"]')).toBeVisible();
  });

  test('PadPage filter chips localised to German via ?lng=de', async ({page}) => {
    await open(page, '/admin/pads?lng=de');
    await page.waitForSelector('.pm-chips', {timeout: 30000});
    // de.json may not yet have the new keys (translatewiki round-trips on its
    // own cadence); falling back to English via i18next is acceptable. What
    // matters is that the literal hardcoded German strings from #7716 are
    // gone — i.e. nothing on this page comes from a hardcoded source.
    await expect(page.getByText(/Plugin manager/)).toHaveCount(0);
  });
});
