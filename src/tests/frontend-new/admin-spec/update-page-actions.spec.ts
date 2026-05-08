import {expect, test} from '@playwright/test';
import {loginToAdmin} from '../helper/adminhelper';

const baseStatus = {
  currentVersion: '2.7.1',
  latest: {
    version: '2.7.2',
    tag: 'v2.7.2',
    body: 'release notes',
    publishedAt: '2026-05-01T00:00:00Z',
    prerelease: false,
    htmlUrl: 'https://github.com/ether/etherpad/releases/tag/v2.7.2',
  },
  lastCheckAt: '2026-05-08T00:00:00Z',
  installMethod: 'git',
  tier: 'manual',
  policy: {canNotify: true, canManual: true, canAuto: false, canAutonomous: false, reason: 'ok'},
  vulnerableBelow: [],
  execution: {status: 'idle'},
  lastResult: null,
  lockHeld: false,
};

test.describe('admin update page actions', () => {
  test.beforeEach(async ({page}) => {
    await loginToAdmin(page, 'admin', 'changeme1');
  });

  test('Apply button posts /admin/update/apply and re-fetches status', async ({page}) => {
    let postedApply = false;
    let statusFetches = 0;
    await page.route('**/admin/update/status', async (route) => {
      statusFetches += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(baseStatus),
      });
    });
    await page.route('**/admin/update/apply', async (route) => {
      postedApply = true;
      await route.fulfill({status: 202, contentType: 'application/json', body: JSON.stringify({accepted: true})});
    });

    await page.goto('http://localhost:9001/admin/update');
    await expect(page.getByRole('button', {name: /apply update/i})).toBeVisible({timeout: 30000});

    await page.getByRole('button', {name: /apply update/i}).click();
    await expect.poll(() => postedApply, {timeout: 15000}).toBe(true);
    // After Apply, the page re-fetches status. Initial load = 1 fetch + Apply re-fetch >= 2.
    await expect.poll(() => statusFetches, {timeout: 15000}).toBeGreaterThanOrEqual(2);
  });

  test('install-method-not-writable hides Apply and shows the policy-denial copy', async ({page}) => {
    const denied = {
      ...baseStatus,
      installMethod: 'docker',
      policy: {canNotify: true, canManual: false, canAuto: false, canAutonomous: false, reason: 'install-method-not-writable'},
    };
    await page.route('**/admin/update/status', (route) =>
      route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(denied)}));

    await page.goto('http://localhost:9001/admin/update');
    // Heading rendered; no Apply button.
    await expect(page.getByRole('heading', {name: /etherpad updates/i})).toBeVisible({timeout: 30000});
    await expect(page.getByRole('button', {name: /apply update/i})).toHaveCount(0);
    // Localised denial copy.
    await expect(page.getByText(/Updates from the admin UI require a git install/i)).toBeVisible();
  });

  test('rollback-failed terminal state shows Acknowledge and lastResult copy', async ({page}) => {
    const terminal = {
      ...baseStatus,
      execution: {
        status: 'rollback-failed',
        reason: 'pnpm install failed; rollback failed: pnpm exit 1',
        targetTag: 'v2.7.2',
        fromSha: 'abc',
        at: '2026-05-08T00:00:00Z',
      },
      lastResult: {
        targetTag: 'v2.7.2',
        fromSha: 'abc',
        outcome: 'rollback-failed',
        reason: 'pnpm install failed',
        at: '2026-05-08T00:00:00Z',
      },
      policy: {canNotify: true, canManual: true, canAuto: false, canAutonomous: false, reason: 'rollback-failed-terminal'},
    };
    await page.route('**/admin/update/status', (route) =>
      route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(terminal)}));

    await page.goto('http://localhost:9001/admin/update');
    await expect(page.getByRole('button', {name: /acknowledge/i})).toBeVisible({timeout: 30000});
    // lastResult copy uses i18n update.page.last_result.rollback-failed.
    await expect(page.getByText(/Manual intervention required/i)).toBeVisible();
  });

  test('lockHeld true hides the Apply button even when policy.canManual is on', async ({page}) => {
    const locked = {...baseStatus, lockHeld: true};
    await page.route('**/admin/update/status', (route) =>
      route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(locked)}));

    await page.goto('http://localhost:9001/admin/update');
    await expect(page.getByRole('heading', {name: /etherpad updates/i})).toBeVisible({timeout: 30000});
    await expect(page.getByRole('button', {name: /apply update/i})).toHaveCount(0);
  });
});
