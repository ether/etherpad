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
    // Record every padLoad request the page sends over the settings socket
    // (attached before navigating so the socket's frames are captured).
    // socket.io event frames look like `42/settings,["padLoad",{...}]`.
    const padLoads: any[] = [];
    page.on('websocket', (ws) => {
      ws.on('framesent', ({payload}) => {
        if (typeof payload !== 'string') return;
        const m = /^42(?:\/[^,]*,)?(\[.*)$/s.exec(payload);
        if (!m) return;
        const [event, query] = JSON.parse(m[1]);
        if (event === 'padLoad') padLoads.push(query);
      });
    });

    await loginToAdmin(page, 'admin', 'changeme1');
    await page.goto(`${ADMIN_URL}/pads`);
    await expect(page.getByRole('heading', {name: 'Manage pads'})).toBeVisible({timeout: 30000});

    const search = page.getByPlaceholder('Search for pads');
    const total = page.locator('.pm-stat-value').first();

    // Search first so the post-create reload has to carry the current
    // (non-empty) pattern rather than a stale one.
    await search.fill(prefix);
    await expect.poll(() => padLoads.some((q) => q.pattern === prefix),
        {timeout: 10000}).toBe(true);

    const padNames = [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`];
    for (const [i, name] of padNames.entries()) {
      // Let any in-flight reload settle before counting.
      await page.waitForTimeout(500);
      const before = padLoads.length;
      await page.getByRole('button', {name: /New Pad/i}).click();
      await page.locator('input[name="padName"]').fill(name);
      await page.locator('input[type="submit"]').click();
      // The create dialog only closes on a successful results:createPad.
      await expect(page.locator('input[name="padName"]')).toBeHidden({timeout: 10000});
      await expect(page.locator('.pm-pad-title', {hasText: name})).toBeVisible({timeout: 10000});
      await expect(total).toHaveText(String(i + 1));
      // Give duplicate handlers time to fire their extra padLoads.
      await page.waitForTimeout(1000);
      const sent = padLoads.slice(before);
      expect(sent, `padLoad requests sent for creating ${name}`).toHaveLength(1);
      expect(sent[0].pattern).toBe(prefix);
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
