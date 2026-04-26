import {expect, test} from "@playwright/test";
import {goToNewPad} from "../helper/padHelper.js";

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

test.describe('error sanitization', () => {

  test('production mode hides error details from gritter popup', async ({page}) => {
    // The test server runs without NODE_ENV=development, so clientVars.mode
    // should cause errors to be sanitized (secure by default).

    // Trigger a JS error in the pad's main window context
    await page.evaluate(() => {
      // Force production mode for this test
      (window as any).clientVars = {...(window as any).clientVars, mode: 'production'};
      // Dispatch an error event that the global exception handler will catch
      window.dispatchEvent(new ErrorEvent('error', {
        message: 'SecretInternalError: database connection string leaked',
        filename: '/opt/etherpad/src/secret_internal_file.ts',
        lineno: 42,
        error: new Error('SecretInternalError: database connection string leaked'),
      }));
    });

    // Wait for gritter popup to appear
    const gritterItem = page.locator('.gritter-item').first();
    await expect(gritterItem).toBeVisible();

    const popupText = await gritterItem.textContent();

    // Should NOT contain the internal error message, file path, or line number
    expect(popupText).not.toContain('SecretInternalError');
    expect(popupText).not.toContain('database connection string leaked');
    expect(popupText).not.toContain('secret_internal_file');
    expect(popupText).not.toContain('UserAgent');

    // Should contain the generic reload message and an ErrorId
    expect(popupText).toContain('Please press and hold Ctrl and press F5 to reload this page');
    expect(popupText).toContain('ErrorId:');
    expect(popupText).toContain('contact your webmaster');
  });

  test('development mode shows full error details in gritter popup', async ({page}) => {
    // Set mode to development
    await page.evaluate(() => {
      (window as any).clientVars = {...(window as any).clientVars, mode: 'development'};
      window.dispatchEvent(new ErrorEvent('error', {
        message: 'TestError: something broke',
        filename: '/opt/etherpad/src/some_file.ts',
        lineno: 99,
        error: new Error('TestError: something broke'),
      }));
    });

    const gritterItem = page.locator('.gritter-item').first();
    await expect(gritterItem).toBeVisible();

    const popupText = await gritterItem.textContent();

    // Should contain the full error details
    expect(popupText).toContain('TestError: something broke');
    expect(popupText).toContain('some_file.ts');
    expect(popupText).toContain('line 99');
    expect(popupText).toContain('ErrorId:');
    expect(popupText).toContain('send this error message to your webmaster');
  });

  test('duplicate errors are deduplicated in both modes', async ({page}) => {
    // Test dedup in production mode (the bug Qodo found)
    await page.evaluate(() => {
      (window as any).clientVars = {...(window as any).clientVars, mode: 'production'};
      const errorEvent = {
        message: 'DuplicateError: same error',
        filename: '/opt/etherpad/src/file.ts',
        lineno: 10,
        error: new Error('DuplicateError: same error'),
      };
      // Fire the same error twice
      window.dispatchEvent(new ErrorEvent('error', errorEvent));
      window.dispatchEvent(new ErrorEvent('error', errorEvent));
    });

    // Wait for the first popup
    await expect(page.locator('.gritter-item').first()).toBeVisible();

    // Should only have one gritter popup, not two
    const count = await page.locator('.gritter-item').count();
    expect(count).toBe(1);
  });

  test('errors before clientVars handshake default to hiding details', async ({page}) => {
    // Simulate pre-handshake state: clientVars exists but has no mode property
    await page.evaluate(() => {
      const cv = (window as any).clientVars;
      delete cv.mode;
      window.dispatchEvent(new ErrorEvent('error', {
        message: 'EarlyError: before handshake',
        filename: '/opt/etherpad/src/internal.ts',
        lineno: 1,
        error: new Error('EarlyError: before handshake'),
      }));
    });

    const gritterItem = page.locator('.gritter-item').first();
    await expect(gritterItem).toBeVisible();

    const popupText = await gritterItem.textContent();

    // Should hide details (secure by default)
    expect(popupText).not.toContain('EarlyError');
    expect(popupText).not.toContain('before handshake');
    expect(popupText).not.toContain('internal.ts');
    expect(popupText).toContain('contact your webmaster');
  });
});
