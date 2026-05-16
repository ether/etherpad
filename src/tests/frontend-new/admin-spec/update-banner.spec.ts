import {expect, test} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper";

test.describe('admin update page', () => {
  test.beforeEach(async ({page}) => {
    await loginToAdmin(page, 'admin', 'changeme1');
  });

  test('exposes the update nav link', async ({page}) => {
    await page.goto('http://localhost:9001/admin/');
    // Bell-icon link with i18nKey "update.page.title" → label "Etherpad updates".
    const link = page.getByRole('link', {name: /etherpad updates/i});
    await expect(link).toBeVisible({timeout: 30000});
  });

  test('update page renders current version when status fetch returns valid payload', async ({page}) => {
    // Stub the status endpoint so the test does not depend on real GitHub state.
    await page.route('**/admin/update/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          currentVersion: '2.7.1',
          latest: null,
          lastCheckAt: null,
          installMethod: 'git',
          tier: 'notify',
          policy: null,
          vulnerableBelow: [],
        }),
      });
    });

    await page.goto('http://localhost:9001/admin/update');
    // h1 from <Trans i18nKey="update.page.title"/> → "Etherpad updates"
    await expect(page.getByRole('heading', {name: /etherpad updates/i})).toBeVisible({timeout: 30000});
    // Current-version <dd> shows 2.7.1
    await expect(page.getByText('2.7.1').first()).toBeVisible();
    // up-to-date message because latest is null
    await expect(page.getByText(/running the latest version/i)).toBeVisible();
  });

  test('banner appears when latest > current', async ({page}) => {
    await page.route('**/admin/update/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          currentVersion: '2.7.1',
          latest: {
            version: '2.7.2',
            tag: 'v2.7.2',
            body: 'Some changes.',
            publishedAt: '2026-04-25T00:00:00Z',
            prerelease: false,
            htmlUrl: 'https://github.com/ether/etherpad/releases/tag/v2.7.2',
          },
          lastCheckAt: '2026-04-25T00:00:00Z',
          installMethod: 'git',
          tier: 'notify',
          policy: {canNotify: true, canManual: false, canAuto: false, canAutonomous: false, reason: 'install-method-not-writable'},
          vulnerableBelow: [],
        }),
      });
    });

    await page.goto('http://localhost:9001/admin/');
    // Banner copy: "Update available" + "Etherpad 2.7.2 is available (you are running 2.7.1)."
    await expect(page.getByText(/update available/i).first()).toBeVisible({timeout: 30000});
    await expect(page.getByText(/2\.7\.2/).first()).toBeVisible();
  });
});
