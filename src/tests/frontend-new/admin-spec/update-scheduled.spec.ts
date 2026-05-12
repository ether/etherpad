import {expect, test} from '@playwright/test';
import {loginToAdmin} from '../helper/adminhelper';

const scheduledStatus = (msFromNow: number) => ({
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
  tier: 'auto',
  policy: {canNotify: true, canManual: true, canAuto: true, canAutonomous: false, reason: 'ok'},
  vulnerableBelow: [],
  execution: {
    status: 'scheduled',
    targetTag: 'v2.7.2',
    scheduledFor: new Date(Date.now() + msFromNow).toISOString(),
    startedAt: new Date().toISOString(),
  },
  lastResult: null,
  lockHeld: false,
});

test.describe('admin update page — Tier 3 scheduled state', () => {
  test.beforeEach(async ({page}) => {
    await loginToAdmin(page, 'admin', 'changeme1');
  });

  test('renders countdown panel, Apply now, and Cancel buttons', async ({page}) => {
    await page.route('**/admin/update/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(scheduledStatus(30_000)),
      }));

    await page.goto('http://localhost:9001/admin/update');
    await expect(page.getByRole('heading', {name: /update scheduled/i})).toBeVisible({timeout: 30000});
    // Scope to the countdown panel — /v2\.7\.2/ also matches the banner and
    // the changelog link, which would trip strict-mode locators.
    const panel = page.locator('section.update-scheduled');
    await expect(panel.getByText(/v2\.7\.2/)).toBeVisible();
    await expect(panel.getByText(/\d+s|\d+m \d+s/)).toBeVisible();
    // Apply now relabel (not the regular "Apply update" copy).
    await expect(page.getByRole('button', {name: /apply now/i})).toBeVisible();
    await expect(page.getByRole('button', {name: /^cancel$/i})).toBeVisible();
  });

  test('Cancel button posts /admin/update/cancel and triggers a status re-fetch', async ({page}) => {
    let postedCancel = false;
    let statusFetches = 0;
    let executionStatus: string = 'scheduled';
    await page.route('**/admin/update/status', async (route) => {
      statusFetches += 1;
      const payload = scheduledStatus(30_000);
      // After Cancel, the next status fetch returns idle to mirror the server.
      if (executionStatus === 'idle') payload.execution = {status: 'idle'} as any;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });
    await page.route('**/admin/update/cancel', async (route) => {
      postedCancel = true;
      executionStatus = 'idle';
      await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({cancelled: true})});
    });

    await page.goto('http://localhost:9001/admin/update');
    await expect(page.getByRole('button', {name: /^cancel$/i})).toBeVisible({timeout: 30000});
    await page.getByRole('button', {name: /^cancel$/i}).click();
    await expect.poll(() => postedCancel, {timeout: 15000}).toBe(true);
    await expect.poll(() => statusFetches, {timeout: 15000}).toBeGreaterThanOrEqual(2);
  });

  test('countdown banner appears at the top of /admin', async ({page}) => {
    await page.route('**/admin/update/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(scheduledStatus(120_000)),
      }));
    await page.goto('http://localhost:9001/admin');
    // Banner copy from update.banner.scheduled
    await expect(page.getByText(/auto-update to v2\.7\.2 scheduled/i)).toBeVisible({timeout: 30000});
  });
});
