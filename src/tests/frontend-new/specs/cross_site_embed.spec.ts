import {expect, test} from '@playwright/test';
import {randomUUID} from 'node:crypto';

// Regression test for https://github.com/ether/etherpad/issues/8513
//
// A pad embedded in an iframe on another site, over plain http, can't use
// cookies: in a cross-site iframe the cookies are set with SameSite=None, which
// browsers reject without Secure, and Secure can't be set over http. The pad
// must still load and fall back to default prefs.
test.describe('pad embedded cross-site over http', () => {
  test('loads even though the prefs cookie cannot be stored', async ({page}) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 127.0.0.1 and localhost are different sites, so embedding a localhost pad
    // in a 127.0.0.1 page is a cross-site embed.
    await page.goto('http://127.0.0.1:9001/static/empty.html');
    const padUrl = `http://localhost:9001/p/FRONTEND_TESTS${randomUUID()}`;
    await page.evaluate((src) => {
      const iframe = document.createElement('iframe');
      iframe.id = 'pad';
      iframe.src = src;
      iframe.width = '1000';
      iframe.height = '700';
      document.body.appendChild(iframe);
    }, padUrl);

    const pad = page.frameLocator('#pad');
    const outer = pad.frameLocator('iframe[name="ace_outer"]');
    const inner = outer.frameLocator('iframe');
    await expect(inner.locator('#innerdocbody')).toBeVisible({timeout: 30000});
    await expect(inner.locator('#innerdocbody')).toHaveAttribute('contenteditable', 'true');

    // Changing a pref writes to padcookie; that must not throw either.
    const lineNumbers = pad.locator('#options-linenoscheck');
    await expect(lineNumbers).toBeChecked();
    await lineNumbers.evaluate((el: HTMLInputElement) => {
      el.checked = false;
      el.dispatchEvent(new Event('change'));
    });
    await expect(outer.locator('#outerdocbody')).toHaveClass(/line-numbers-hidden/);

    expect(pageErrors).toEqual([]);
  });
});
