import {type Page, test, expect} from '@playwright/test';

test.describe('Session Transfer Functionality', () => {
  const validCode = '12345678-1234-5678-1234-567812345678';

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

  const openSettingsDialog = async (page: Page) => {
    await page.locator('.settings-button').click();
    const dialog = page.locator('#settings-dialog');
    await expect(dialog).toBeVisible();
    return dialog;
  };

  const openReceiveSession = async (page: Page) => {
    await openSettingsDialog(page);
    await page
      .locator('#button-bar button[data-l10n-id="index.receiveSessionTitle"]')
      .click();
  };

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

    await openSettingsDialog(page);

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

  test('should keep create transfer controls usable after a 400 response', async ({ page }) => {
    await page.route('**/tokenTransfer', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'No author cookie to transfer' }),
      });
    });

    await openSettingsDialog(page);

    const transferButton = page.locator('[data-l10n-id="index.transferSessionNow"]');
    await transferButton.click();

    await expect(page.locator('#copy-link-section')).toBeHidden();
    await expect(transferButton).not.toBeDisabled();
    await expect(transferButton.locator('svg')).toHaveCount(0);
    await expect(page.locator('#transfer-session-error'))
      .toHaveText('No author cookie to transfer');
  });

  test('should render create transfer server errors as text', async ({ page }) => {
    const serverError = '<img src=x onerror="window.sessionTransferXss = true">Token failed';
    await page.route('**/tokenTransfer', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: serverError }),
      });
    });

    await openSettingsDialog(page);
    await page.locator('[data-l10n-id="index.transferSessionNow"]').click();

    const error = page.locator('#transfer-session-error');
    await expect(error).toHaveText(serverError);
    await expect(error.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).sessionTransferXss)).toBeUndefined();
  });

  test('should treat create transfer 2xx without an id as a failure', async ({ page }) => {
    await page.route('**/tokenTransfer', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await openSettingsDialog(page);

    const transferButton = page.locator('[data-l10n-id="index.transferSessionNow"]');
    await transferButton.click();

    await expect(page.locator('#copy-link-section')).toBeHidden();
    await expect(transferButton).not.toBeDisabled();
    await expect(page.locator('#transfer-session-error')).toBeVisible();
  });

  test('should not treat a non-2xx create response with an id as success', async ({ page }) => {
    await page.route('**/tokenTransfer', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'transfer-id-from-error-response' }),
      });
    });

    await openSettingsDialog(page);

    const transferButton = page.locator('[data-l10n-id="index.transferSessionNow"]');
    await transferButton.click();

    await expect(page.locator('#copy-link-section')).toBeHidden();
    await expect(transferButton).not.toBeDisabled();
    await expect(page.locator('#transfer-session-error')).toBeVisible();
  });

  test('should not expose copy state after a create transfer network failure', async ({ page }) => {
    await page.route('**/tokenTransfer', async (route) => route.abort());

    await openSettingsDialog(page);

    const transferButton = page.locator('[data-l10n-id="index.transferSessionNow"]');
    await transferButton.click();

    await expect(page.locator('#copy-link-section')).toBeHidden();
    await expect(transferButton).not.toBeDisabled();
    await expect(page.locator('#transfer-session-error')).toBeVisible();
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

    await openSettingsDialog(page);
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
    await page.route(`**/tokenTransfer/${validCode}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await openReceiveSession(page);

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

  test('should not reload and should preserve code after a missing transfer id', async ({ page }) => {
    await page.route(`**/tokenTransfer/${validCode}`, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Token not found' }),
      });
    });

    await openReceiveSession(page);

    const codeInput = page.locator('#codeInput');
    const transferButton = page.locator('#transferSessionButton');
    await codeInput.fill(validCode);
    await transferButton.click();

    await expect(page.locator('#settings-dialog')).toBeVisible();
    await expect(codeInput).toHaveValue(validCode);
    await expect(transferButton).not.toBeDisabled();
    await expect(page.locator('#receive-session-error')).toHaveText('Token not found');
  });

  test('should not reload and should preserve code after an expired transfer id', async ({ page }) => {
    await page.route(`**/tokenTransfer/${validCode}`, async (route) => {
      await route.fulfill({
        status: 410,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Token expired' }),
      });
    });

    await openReceiveSession(page);

    const codeInput = page.locator('#codeInput');
    const transferButton = page.locator('#transferSessionButton');
    await codeInput.fill(validCode);
    await transferButton.click();

    await expect(page.locator('#settings-dialog')).toBeVisible();
    await expect(codeInput).toHaveValue(validCode);
    await expect(transferButton).not.toBeDisabled();
    await expect(page.locator('#receive-session-error')).toHaveText('Token expired');
  });

  test('should not reload when receive transfer response is not valid JSON', async ({ page }) => {
    await page.route(`**/tokenTransfer/${validCode}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'not-json',
      });
    });

    await openReceiveSession(page);

    const codeInput = page.locator('#codeInput');
    const transferButton = page.locator('#transferSessionButton');
    await codeInput.fill(validCode);
    await transferButton.click();

    await expect(page.locator('#settings-dialog')).toBeVisible();
    await expect(codeInput).toHaveValue(validCode);
    await expect(transferButton).not.toBeDisabled();
    await expect(page.locator('#receive-session-error')).toBeVisible();
  });

  test('should keep transfer button disabled for invalid code length', async ({
                                                                                page,
                                                                              }) => {
    await openReceiveSession(page);

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
    await openSettingsDialog(page);

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
    await openSettingsDialog(page);
    const dialog = page.locator('#settings-dialog');

    await expect(dialog).toBeVisible();

    await dialog.evaluate((el) => (el as HTMLElement).click());

    await expect(dialog).not.toBeVisible();
  });
});
