import {expect, test} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper";

// Regression coverage for issue #8457: PadPage's results:* socket listeners
// were re-registered every time `pads` changed (the useEffect depended on
// `pads` with no cleanup), so each list reload piled up another set. Each
// subsequent `results:deletePad`/`results:createPad` reply then ran once per
// accumulated set, making "Total pads" and the per-pad list go wrong after a
// few reloads. See admin/src/pages/PadPage.tsx (the useEffect's cleanup now
// calls settingsSocket.off(...) for each handler it adds).

test.describe.configure({mode: 'serial'});

const ADMIN_URL = 'http://localhost:9001/admin';

test.describe('admin Manage pads does not accumulate socket listeners', () => {
  const prefix = `pw-leak-8457-${Date.now()}`;

  test('deleting pads after several list reloads decrements the total correctly', async ({page}) => {
    await loginToAdmin(page, 'admin', 'changeme1');
    await page.goto(`${ADMIN_URL}/pads`);
    await expect(page.getByRole('heading', {name: 'Manage pads'})).toBeVisible({timeout: 30000});

    const search = page.getByPlaceholder('Search for pads');
    const total = page.locator('.pm-stat-value').first();

    const padNames = [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`];
    for (const name of padNames) {
      await page.getByRole('button', {name: /New Pad/i}).click();
      await page.locator('input[name="padName"]').fill(name);
      await page.locator('input[type="submit"]').click();
      // Wait for the create dialog to close, which only happens on a
      // successful results:createPad — the symptom this guards against is
      // extra *duplicate* padLoad round-trips, not a missing one.
      await expect(page.locator('input[name="padName"]')).toBeHidden({timeout: 10000});
    }

    // Reload the list a few times, the way opening/leaving/reopening the
    // page (or repeated searches) does, to pile up re-subscriptions if the
    // effect cleanup regresses.
    for (let i = 0; i < 4; i++) {
      await page.goto(`${ADMIN_URL}/pads`);
      await expect(page.getByRole('heading', {name: 'Manage pads'})).toBeVisible({timeout: 30000});
    }

    await search.fill(prefix);
    await expect(page.locator('.pm-pad-title', {hasText: `${prefix}-a`})).toBeVisible({timeout: 15000});
    await expect(total).toHaveText('3');

    const deleteButtons = page.locator('.pm-btn-icon--danger');

    const confirmDelete = page.getByRole('button', {name: 'OK', exact: true});

    await deleteButtons.first().click();
    await confirmDelete.click();
    await expect(total).toHaveText('2', {timeout: 15000});

    await deleteButtons.first().click();
    await confirmDelete.click();
    await expect(total).toHaveText('1', {timeout: 15000});

    await deleteButtons.first().click();
    await confirmDelete.click();
    await expect(total).toHaveText('0', {timeout: 15000});
  });
});
