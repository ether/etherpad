import {expect, test, Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

// Gritter items for outdated-notice are rendered into #gritter-container.bottom
// and tagged with class_name:'outdated-notice' so tests can target them
// independently of any other gritter surfaced during the pad session.
const NOTICE = '#gritter-container.bottom .gritter-item.outdated-notice';

const freshPad = async (page: Page, clientVarOverrides: Record<string, unknown> = {}) => {
  // Suppress the pad-deletion-token modal (same technique as goToNewPad in
  // padHelper.ts) so it can't race with postAceInit or steal DOM focus.
  // clientVarOverrides lets a test simulate server-side settings (e.g.
  // updateCheck:false for updates.tier "off") without restarting the server.
  // updateCheck defaults to true because every test mocks
  // /api/version-status: the result must not depend on the server's
  // updates.tier (plugin CI runs core with the tier "off").
  const overrides = {updateCheck: true, ...clientVarOverrides};
  await page.addInitScript((overrides) => {
    let stored: unknown;
    Object.defineProperty(window, 'clientVars', {
      configurable: true,
      get() { return stored; },
      set(v) {
        if (v != null && typeof v === 'object') {
          (v as {padDeletionToken?: string | null}).padDeletionToken = null;
          Object.assign(v, overrides);
        }
        stored = v;
      },
    });
  }, overrides);
  const padId = `FRONTEND_TESTS${randomUUID()}`;
  await page.goto(`http://localhost:9001/p/${padId}`);
  await page.waitForSelector('iframe[name="ace_outer"]');
  await page.waitForSelector('#editorcontainer.initialized');
  // Wait for the inner editor to be content-editable so postAceInit has fully
  // resolved and the async maybeShowOutdatedNotice fetch has been dispatched.
  await page.frameLocator('iframe[name="ace_outer"]')
            .frameLocator('iframe[name="ace_inner"]')
            .locator('#innerdocbody[contenteditable="true"]')
            .waitFor({state: 'attached'});
  return padId;
};

test.describe('outdated notice (gritter-based)', () => {
  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  test('outdated:null — no outdated-notice gritter is shown', async ({page}) => {
    await page.route('**/api/version-status*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({outdated: null, isFirstAuthor: true}),
      }));
    await freshPad(page);
    await expect(page.locator(NOTICE)).toHaveCount(0);
  });

  test('outdated:minor, isFirstAuthor:false — no gritter shown (client guard)',
      async ({page}) => {
        await page.route('**/api/version-status*', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({outdated: 'minor', isFirstAuthor: false}),
          }));
        await freshPad(page);
        await expect(page.locator(NOTICE)).toHaveCount(0);
      });

  test('outdated:minor, isFirstAuthor:true — gritter appears with correct text',
      async ({page}) => {
        await page.route('**/api/version-status*', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({outdated: 'minor', isFirstAuthor: true}),
          }));
        await freshPad(page);
        const item = page.locator(NOTICE);
        await expect(item).toBeVisible();
        await expect(item.locator('.gritter-title')).toHaveText('Etherpad update available');
        await expect(item).toContainText(
            'A newer version of Etherpad has been released');
      });

  test('user dismisses by clicking X — gritter disappears', async ({page}) => {
    await page.route('**/api/version-status*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({outdated: 'minor', isFirstAuthor: true}),
      }));
    await freshPad(page);
    const item = page.locator(NOTICE);
    await expect(item).toBeVisible();
    await item.locator('.gritter-close').click();
    await expect(page.locator(NOTICE)).toHaveCount(0);
  });

  test('server returns 500 — no gritter and no user-visible error', async ({page}) => {
    await page.route('**/api/version-status*', (route) =>
      route.fulfill({status: 500, body: 'Internal Server Error'}));
    await freshPad(page);
    // Allow the async fetch to settle before asserting nothing appeared.
    await page.waitForTimeout(500);
    await expect(page.locator(NOTICE)).toHaveCount(0);
    // No generic JS error dialog should have appeared.
    await expect(page.locator('#errorpopup')).toHaveCount(0);
  });

  test('auto-fade after 8s — gritter gone after 9s', async ({page}) => {
    // This test deliberately waits ~9 s for the gritter's time:8000 to elapse.
    // Mark as slow so Playwright allocates a larger timeout budget.
    test.slow();
    await page.route('**/api/version-status*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({outdated: 'minor', isFirstAuthor: true}),
      }));
    await freshPad(page);
    // Confirm it appeared first.
    await expect(page.locator(NOTICE)).toBeVisible();
    // Wait for auto-fade (time:8000 ms in the gritter.add call).
    await page.waitForTimeout(9000);
    await expect(page.locator(NOTICE)).toHaveCount(0);
  });

  test('updateCheck:false (updates.tier "off") — no /api/version-status request',
      async ({page}) => {
        // Issue #8573: the server does not register the endpoint when the tier
        // is off, so the client must not call it at all (no 404 in devtools).
        const requests: string[] = [];
        page.on('request', (req) => {
          if (req.url().includes('/api/version-status')) requests.push(req.url());
        });
        await freshPad(page, {updateCheck: false});
        await page.waitForTimeout(1000);
        expect(requests).toEqual([]);
        await expect(page.locator(NOTICE)).toHaveCount(0);
      });

  // freshPad forces updateCheck:true, so this checks the client side only. The
  // server's tier -> clientVars.updateCheck mapping is covered by the backend
  // spec updateCheckClientVar.ts.
  test('updateCheck:true — the version-status request is made', async ({page}) => {
    const requests: string[] = [];
    await page.route('**/api/version-status*', (route) => {
      requests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({outdated: null, isFirstAuthor: true}),
      });
    });
    await freshPad(page);
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toContain('padId=');
  });
});
