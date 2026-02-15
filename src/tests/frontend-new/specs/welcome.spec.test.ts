import { test, expect } from '@playwright/test';

test.describe('Session Transfer Functionality', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([
      {
        name: 'token',
        value: 'test-token-123',
        domain: 'localhost',
        path: '/',
      },
      {
        name: 'prefsHttp',
        value: 'test-prefs',
        domain: 'localhost',
        path: '/',
      },
    ]);

    await page.goto('localhost:9001/');
  });

  test('should open settings dialog and transfer session', async ({
                                                                    page,
                                                                  }) => {
    await page.route('**/tokenTransfer', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'transfer-id-12345678-1234-5678' }),
      });
    });

    await page.locator('.settings-button').click();
    const dialog = page.locator('#settings-dialog');
    await expect(dialog).toBeVisible();

    const transferButton = page.locator(
      '[data-l10n-id="index.transferSessionNow"]'
    );
    await expect(transferButton).toBeVisible();

    await transferButton.click();

    await expect(transferButton).toBeDisabled();
    await expect(transferButton.locator('svg')).toBeVisible();

    const copyLinkSection = page.locator('#copy-link-section');
    await expect(copyLinkSection).toBeVisible();

    const copyButton = copyLinkSection.locator('.btn-secondary');
    await expect(copyButton).toBeVisible();
  });

  test('should copy transfer ID to clipboard', async ({ page }) => {
    const transferId = 'abc123-transfer-id-xyz789';

    await page.route('**/tokenTransfer', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: transferId }),
      });
    });

    await page.locator('.settings-button').click();
    await page
      .locator('[data-l10n-id="index.transferSessionNow"]')
      .click();

    const copyButton = page.locator('#copy-link-section .btn-secondary');
    await expect(copyButton).toBeVisible();

    await page.evaluate(() => {
      // @ts-ignore
      window.clipboardData = '';
      navigator.clipboard.writeText = async (text: string) => {
        // @ts-ignore
        window.clipboardData = text;
        return Promise.resolve();
      };
    });

    await copyButton.click();

    await expect(copyButton).toBeDisabled();
    await expect(copyButton.locator('svg')).toBeVisible();

    const clipboardText = await page.evaluate(
      // @ts-ignore
      () => window.clipboardData
    );
    expect(clipboardText).toBe(transferId);
  });

  test('should receive session with valid code', async ({ page }) => {
    const validCode = '12345678-1234-5678-1234-567812345678';

    await page.route(`**/tokenTransfer/${validCode}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.locator('.settings-button').click();

    await page
      .locator('#button-bar button[data-l10n-id="index.receiveSessionTitle"]')
      .click();

    const receiveSection = page.locator('#transfer-to-system-section');
    await expect(receiveSection).toBeVisible();

    const codeInput = page.locator('#codeInput');
    await expect(codeInput).toBeVisible();

    const transferButton = page.locator('#transferSessionButton');
    await expect(transferButton).toBeDisabled();

    await codeInput.fill(validCode);

    await expect(transferButton).not.toBeDisabled();

    await Promise.all([
      page.waitForNavigation(),
      transferButton.click(),
    ]);
  });

  test('should keep transfer button disabled for invalid code length', async ({
                                                                                page,
                                                                              }) => {
    await page.locator('.settings-button').click();

    await page
      .locator('#button-bar button[data-l10n-id="index.receiveSessionTitle"]')
      .click();

    const codeInput = page.locator('#codeInput');
    const transferButton = page.locator('#transferSessionButton');

    await codeInput.fill('short-code');
    await expect(transferButton).toBeDisabled();

    await codeInput.fill(
      '12345678-1234-5678-1234-567812345678-extra'
    );
    await expect(transferButton).toBeDisabled();

    await codeInput.fill('');
    await expect(transferButton).toBeDisabled();
  });

  test('should switch between tabs in settings dialog', async ({
                                                                 page,
                                                               }) => {
    await page.locator('.settings-button').click();

    const transferTab = page.locator(
      '#button-bar button[data-l10n-id="index.transferSessionTitle"]'
    );
    const receiveTab = page.locator(
      '#button-bar button[data-l10n-id="index.receiveSessionTitle"]'
    );

    await expect(transferTab).toHaveClass(/active-btn/);

    await receiveTab.click();
    await expect(receiveTab).toHaveClass(/active-btn/);
    await expect(transferTab).not.toHaveClass(/active-btn/);

    await expect(
      page.locator('#transfer-to-system-section')
    ).toBeVisible();

    await transferTab.click();
    await expect(transferTab).toHaveClass(/active-btn/);
  });

  test('should close dialog when clicking outside', async ({ page }) => {
    await page.locator('.settings-button').click();
    const dialog = page.locator('#settings-dialog');

    await expect(dialog).toBeVisible();

    await dialog.evaluate((el) => (el as HTMLElement).click());

    await expect(dialog).not.toBeVisible();
  });
});
