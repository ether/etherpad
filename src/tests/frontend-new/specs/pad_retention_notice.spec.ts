import {expect, test, Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

// The pad retention notice (src/static/js/pad_retention_notice.ts). The CI
// server runs with padRetention off, so these drive the real show function
// through its webdriver-only test hook. The server side, including what
// clientVars.padRetention carries, is covered in
// src/tests/backend/specs/padRetention.ts.
const NOTICE = '#gritter-container.bottom .gritter-item.pad-retention-notice';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const freshPad = async (page: Page) => {
  await page.goto(`http://localhost:9001/p/FRONTEND_TESTS${randomUUID()}`);
  await page.waitForSelector('iframe[name="ace_outer"]');
  await page.waitForSelector('#editorcontainer.initialized');
};

const show = (page: Page, info: any) =>
  page.evaluate((i) => { (window as any).__etherpad_padRetention__.show(i); }, info);

test.describe('pad retention notice', () => {
  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  test('no notice when retention is off', async ({page}) => {
    await freshPad(page);
    await expect(page.locator(NOTICE)).toHaveCount(0);
  });

  test('warns in days when more than a day is left', async ({page}) => {
    await freshPad(page);
    await show(page, {state: 'expiring', msRemaining: 3 * DAY_MS - HOUR_MS});
    const notice = page.locator(NOTICE);
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText('This pad will be deleted soon');
    await expect(notice).toContainText(
        'This pad will be deleted if nobody edits it in the next 3 days. ' +
        'Edit or export it to keep your work.');
  });

  test('warns in hours, singular, when under a day is left', async ({page}) => {
    await freshPad(page);
    await show(page, {state: 'expiring', msRemaining: 30 * 60 * 1000});
    await expect(page.locator(NOTICE)).toContainText(
        'This pad will be deleted if nobody edits it in the next 1 hour.');
  });

  test('tells the user an expired pad was deleted', async ({page}) => {
    await freshPad(page);
    await show(page, {state: 'expired', deleteAfterDays: 90});
    const notice = page.locator(NOTICE);
    await expect(notice).toContainText('Pad deleted');
    await expect(notice).toContainText(
        "This pad's previous content was deleted because nobody had edited it for 90 days. " +
        'This is a new pad.');
  });

  test('the notice can be closed', async ({page}) => {
    await freshPad(page);
    await show(page, {state: 'expiring', msRemaining: 3 * DAY_MS});
    const notice = page.locator(NOTICE);
    await notice.hover();
    await notice.locator('.gritter-close').click();
    await expect(notice).toHaveCount(0);
  });
});
