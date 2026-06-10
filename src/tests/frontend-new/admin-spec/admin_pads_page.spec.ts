import {expect, test} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper";
import {goToPad, writeToPad} from "../helper/padHelper";

// End-to-end coverage for issue #7935: a pad that exists must be visible
// both on the welcome page's "recent pads" list (driven by localStorage,
// i.e. gated on the browser having opened the pad) and in the admin
// "Manage pads" UI (driven by the /settings socket `padLoad` handler,
// which enumerates the DB). The admin side regressed when a single
// unreadable pad record made `padLoad` throw and silently return nothing
// — see specs/admin/padLoadResilience.ts for the server-side guard.

// /admin tests mutate global server state, so keep them serial.
test.describe.configure({mode: 'serial'});

const ADMIN_URL = 'http://localhost:9001/admin';

test.describe('a created pad shows up on the home page and in /admin', () => {
  // Unique, URL-safe id so the recent-pads localStorage entry and the admin
  // search both target exactly this pad and ignore leftovers from other suites.
  const padId = `pw-pads-7935-${Date.now()}`;

  test('opening a pad lists it in the welcome page recent-pads', async ({page}) => {
    await goToPad(page, padId);
    await writeToPad(page, 'hello from 7935');

    // Opening the pad writes it to `recentPads` localStorage (colibris
    // pad.js). The welcome page renders that list — same browser context,
    // so the entry carries over.
    await page.goto('http://localhost:9001/');
    const recentPad = page.locator('.recent-pad', {hasText: padId});
    await expect(recentPad).toBeVisible({timeout: 10000});
    await expect(recentPad.locator('a')).toHaveText(padId);
  });

  test('the same pad is listed in the admin Manage pads UI', async ({page}) => {
    await loginToAdmin(page, 'admin', 'changeme1');
    await page.goto(`${ADMIN_URL}/pads`);

    await expect(page.getByRole('heading', {name: 'Manage pads'}))
        .toBeVisible({timeout: 30000});

    // Narrow the (full-scan) listing to our pad. The search is debounced
    // server-side; allow the round-trip to settle.
    const search = page.getByPlaceholder('Search for pads');
    await search.fill(padId);

    await expect(page.locator('.pm-pad-title', {hasText: padId}))
        .toBeVisible({timeout: 15000});
    // The "No results" empty state must NOT be showing — the exact #7935
    // symptom was an empty Manage-pads list for pads that demonstrably exist.
    await expect(page.locator('.pm-empty')).toHaveCount(0);
  });
});
