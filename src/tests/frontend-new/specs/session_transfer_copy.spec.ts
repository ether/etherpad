import {expect, test} from '@playwright/test';

// ether/etherpad#8173: the session transfer dialog used to tell users to
// copy and open a "link", but the flow actually copies a one-time code that
// has to be pasted into the "Receive session" tab of the other browser, and
// it only moves the author identity and preferences, not a full login
// session. These assertions check the rendered (localized) English copy
// matches that behaviour.
test.describe('session transfer dialog copy', () => {
  test.beforeEach(async ({page}) => {
    await page.goto('http://localhost:9001/?lang=en');
    await page.locator('.settings-button').click();
    await expect(page.locator('#settings-dialog')).toBeVisible();
  });

  test('transfer tab describes a code, not a link', async ({page}) => {
    const description = page.locator('[data-l10n-id="index.transferSessionDescription"]');
    await expect(description).toContainText('code');
    await expect(description).toContainText('author identity');
    await expect(description).not.toContainText('link');

    await expect(page.locator('[data-l10n-id="index.transferSessionNow"]'))
        .toHaveText('Create transfer code');

    await page.route('**/tokenTransfer', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({id: '12345678-1234-5678-1234-567812345678'}),
    }));
    await page.locator('[data-l10n-id="index.transferSessionNow"]').click();

    const copySection = page.locator('#copy-link-section');
    await expect(copySection).toBeVisible();
    await expect(copySection.locator('[data-l10n-id="index.copyLink"]'))
        .toHaveText('2. Copy the transfer code');
    await expect(copySection.locator('[data-l10n-id="index.copyLinkDescription"]'))
        .not.toContainText('link');
    await expect(copySection.locator('[data-l10n-id="index.copyLinkButton"]'))
        .toHaveText('Copy code to clipboard');
  });

  test('receive tab asks for the code to be pasted', async ({page}) => {
    await page.locator('#button-bar button[data-l10n-id="index.receiveSessionTitle"]').click();
    const receiveSection = page.locator('#transfer-to-system-section');
    await expect(receiveSection).toBeVisible();
    await expect(receiveSection.locator('[data-l10n-id="index.transferToSystem"]'))
        .toHaveText('3. Paste the transfer code');
    const description =
        receiveSection.locator('[data-l10n-id="index.transferToSystemDescription"]');
    await expect(description).toContainText('Paste');
    await expect(description).not.toContainText('link');
    await expect(receiveSection.locator('[data-l10n-id="index.receiveSessionDescription"]'))
        .toContainText('author identity');
    await expect(receiveSection.locator('#codeInput')).toBeVisible();
  });
});
