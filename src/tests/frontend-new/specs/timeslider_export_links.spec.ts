import {expect, Page, test} from "@playwright/test";
import {clearPadContent, goToPad, writeToPad} from "../helper/padHelper";

// Ported from the legacy mocha suite (timeslider_numeric_padID.js and the
// "checks the export url" case in timeslider_revisions.js), neither of which
// ran in CI. Re-targeted at the in-pad history UI (#7659): the export links
// live in the outer #exportColumn and pad_mode.ts rewrites their hrefs to
// /p/<pad>/<rev>/export/<type> for the revision currently being viewed.
test.describe('timeslider export links', function () {
  test.describe.configure({mode: 'serial'});

  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  // Suppress the one-time pad-deletion-token modal (same trick goToNewPad uses)
  // so it can't steal focus mid-test on a creator session.
  const suppressDeletionTokenModal = async (page: Page) => {
    await page.addInitScript(() => {
      let stored: unknown;
      Object.defineProperty(window, 'clientVars', {
        configurable: true,
        get() { return stored; },
        set(v) {
          if (v != null && typeof v === 'object') {
            (v as {padDeletionToken?: string | null}).padDeletionToken = null;
          }
          stored = v;
        },
      });
    });
  };

  const enterHistoryMode = async (page: Page) => {
    await page.click('.buttonicon-history');
    await page.waitForSelector('#history-controls:not([hidden])', {state: 'visible'});
    await page.waitForSelector('#history-frame');
  };

  const goToRevision = async (page: Page, rev: number) => {
    await page.locator('#history-slider-input').evaluate((el, value) => {
      (el as HTMLInputElement).value = String(value);
      el.dispatchEvent(new Event('input', {bubbles: true}));
    }, rev);
    await expect(page.locator('#history-banner-rev')).toHaveText(`Version ${rev}`, {timeout: 15000});
  };

  const exportHref = (page: Page, id: string) =>
    page.locator(`#${id}`).getAttribute('href');

  test('export hrefs target the viewed revision, including a numeric pad id', async function ({page}) {
    // A numeric pad id is the specific case the legacy test guarded — the
    // href rewriter must not confuse it with the revision segment. Use a
    // high-entropy numeric id (timestamp + random) so reruns against a
    // persistent DB can't collide on the same pad.
    const padId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await suppressDeletionTokenModal(page);
    await goToPad(page, padId); // navigates and waits for the editor to be ready
    await clearPadContent(page);

    await writeToPad(page, 'One ');
    await page.waitForTimeout(400);
    await writeToPad(page, 'Two ');
    await page.waitForTimeout(800);

    await enterHistoryMode(page);

    // Wait for pad_mode to sync the slider max from the embedded BroadcastSlider.
    await expect.poll(
        async () => await page.locator('#history-slider-input').evaluate(
            (el) => Number((el as HTMLInputElement).max)),
        {timeout: 15000}).toBeGreaterThan(0);
    const maxRev = await page.locator('#history-slider-input').evaluate(
        (el) => Number((el as HTMLInputElement).max));
    expect(maxRev).toBeGreaterThan(0);

    // On entry the slider is at the latest revision; hrefs point there.
    await expect.poll(() => exportHref(page, 'exporthtmla'), {timeout: 15000})
        .toContain(`/${padId}/${maxRev}/export/html`);
    expect(await exportHref(page, 'exportplaina')).toContain(`/${padId}/${maxRev}/export/txt`);

    // Scrub to revision 0 — the export targets must follow.
    await goToRevision(page, 0);
    await expect.poll(() => exportHref(page, 'exporthtmla'), {timeout: 15000})
        .toContain(`/${padId}/0/export/html`);
    expect(await exportHref(page, 'exportplaina')).toContain(`/${padId}/0/export/txt`);
  });
});
