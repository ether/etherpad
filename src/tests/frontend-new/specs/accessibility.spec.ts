import { test, expect } from '@playwright/test';

test.describe('Accessibility ARIA attributes', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to a new pad
        await page.goto('http://localhost:9001/p/accessibility-test');
        // Wait for the pad to load
        await expect(page.locator('#editorcontainer')).toHaveClass(/initialized/);
    });

    test('should have ARIA attributes on frames and body by default', async ({ page }) => {
        // Outer iframe
        const outerFrameElement = page.locator('iframe[name="ace_outer"]');
        await expect(outerFrameElement).toHaveAttribute('role', 'application');
        await expect(outerFrameElement).toHaveAttribute('aria-label', 'Etherpad editor');

        // Inner iframe (inside outer iframe)
        const outerFrame = page.frameLocator('iframe[name="ace_outer"]');
        const innerFrameElement = outerFrame.locator('iframe[name="ace_inner"]');
        await expect(innerFrameElement).toHaveAttribute('role', 'document');
        await expect(innerFrameElement).toHaveAttribute('aria-label', 'Pad content');

        // Inner doc body (inside inner iframe)
        const innerFrame = outerFrame.frameLocator('iframe[name="ace_inner"]');
        const innerBody = innerFrame.locator('body#innerdocbody');
        await expect(innerBody).toHaveAttribute('role', 'textbox');
        await expect(innerBody).toHaveAttribute('aria-multiline', 'true');
        await expect(innerBody).toHaveAttribute('aria-label', 'Pad content');
    });
});
