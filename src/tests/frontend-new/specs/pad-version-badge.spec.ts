import {expect, test} from '@playwright/test';

const padUrl = (id = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`) =>
  `http://localhost:9001/p/${id}`;

test.describe('pad version badge', () => {
  test('hidden when /api/version-status returns outdated:null', async ({page}) => {
    await page.route('**/api/version-status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({outdated: null}),
      }));
    await page.goto(padUrl());
    const badge = page.locator('#version-badge');
    // The badge is rendered hidden (display:none) and stays hidden.
    await expect(badge).toBeHidden({timeout: 30000});
  });

  test('shows severe text when outdated=severe', async ({page}) => {
    await page.route('**/api/version-status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({outdated: 'severe'}),
      }));
    await page.goto(padUrl());
    const badge = page.locator('#version-badge');
    await expect(badge).toBeVisible({timeout: 30000});
    await expect(badge).toContainText(/severely outdated/i);
    await expect(badge).toHaveAttribute('data-level', 'severe');
  });

  test('shows vulnerable text when outdated=vulnerable', async ({page}) => {
    await page.route('**/api/version-status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({outdated: 'vulnerable'}),
      }));
    await page.goto(padUrl());
    const badge = page.locator('#version-badge');
    await expect(badge).toBeVisible({timeout: 30000});
    await expect(badge).toContainText(/security issues/i);
    await expect(badge).toHaveAttribute('data-level', 'vulnerable');
  });
});
