import { test, expect } from '@playwright/test';

test.describe('Recent Pads', () => {
  test('should display correctly encoded URLs for recent pads', async ({ page }) => {
    const padName = 'test pad with spaces & / chars';
    const recentPads = [
      {
        name: padName,
        timestamp: new Date().toISOString(),
        members: 1,
      },
    ];

    // Add recent pad to localStorage before navigating
    await page.addInitScript((data) => {
      window.localStorage.setItem('recentPads', data);
    }, JSON.stringify(recentPads));

    await page.goto('localhost:9001/');

    const recentPad = page.locator('.recent-pad').first();
    await expect(recentPad).toBeVisible();

    const link = recentPad.locator('a');
    await expect(link).toHaveText(padName);
    
    // Assert the href has the properly encoded URL
    const expectedEncodedName = encodeURIComponent(padName);
    const expectedHrefRegex = new RegExp(`p/${expectedEncodedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    await expect(link).toHaveAttribute('href', expectedHrefRegex);
  });
});
