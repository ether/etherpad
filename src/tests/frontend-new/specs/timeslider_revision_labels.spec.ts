import {expect, Page, test} from "@playwright/test";
import {clearPadContent, goToNewPad, writeToPad} from "../helper/padHelper";

// Ported from the legacy mocha suite (src/tests/frontend/specs/timeslider_labels.js),
// which no CI workflow ran. Re-targeted at the in-pad history UI (#7659): the
// revision label and date are shown in the outer #history-banner, populated by
// pad_mode.ts mirroring the embedded timeslider's #revision_label / #revision_date.
// This guards the banner bridge against silently breaking again (cf. #7946).
test.describe('timeslider revision labels', function () {
  test.describe.configure({mode: 'serial'});
  // The "Version N" label and "Saved <Month> <day>, <year>" date are localized
  // (timeslider.version / timeslider.saved). Pin the locale so the assertions
  // are deterministic and the date string stays Date-parseable.
  test.use({locale: 'en-US'});

  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  const enterHistoryMode = async (page: Page) => {
    await page.click('.buttonicon-history');
    await page.waitForSelector('#history-controls:not([hidden])', {state: 'visible'});
    await page.waitForSelector('#history-frame');
  };

  // Drive the outer slider (a remote control for the embedded BroadcastSlider)
  // to a specific revision and wait for the banner to reflect it.
  const goToRevision = async (page: Page, rev: number) => {
    await page.locator('#history-slider-input').evaluate((el, value) => {
      (el as HTMLInputElement).value = String(value);
      el.dispatchEvent(new Event('input', {bubbles: true}));
    }, rev);
    await expect(page.locator('#history-banner-rev')).toHaveText(`Version ${rev}`, {timeout: 15000});
  };

  // "Saved June 12, 2026" -> a parseable Date (the banner mirrors the
  // timeslider.saved l10n string "Saved {{month}} {{day}}, {{year}}").
  const parsedBannerDate = async (page: Page) => await page.locator('#history-banner-date').evaluate(
      (el) => new Date((el.textContent || '').replace(/^Saved\s+/i, '')).getTime());

  test('shows Version label and a valid date that update while scrubbing', async function ({page}) {
    await goToNewPad(page);
    await clearPadContent(page);

    // Produce a few revisions.
    await writeToPad(page, 'Alpha ');
    await page.waitForTimeout(400);
    await writeToPad(page, 'Beta ');
    await page.waitForTimeout(400);
    await writeToPad(page, 'Gamma ');
    await page.waitForTimeout(800);

    await enterHistoryMode(page);

    // On entry the slider sits at the latest revision; the banner must show a
    // non-empty "Version N" label and a non-NaN date. Wait for pad_mode to sync
    // the slider max from the embedded BroadcastSlider before reading it.
    await expect.poll(
        async () => await page.locator('#history-slider-input').evaluate(
            (el) => Number((el as HTMLInputElement).max)),
        {timeout: 15000}).toBeGreaterThan(0);
    const maxRev = await page.locator('#history-slider-input').evaluate(
        (el) => Number((el as HTMLInputElement).max));
    expect(maxRev).toBeGreaterThan(0);

    await expect(page.locator('#history-banner-rev')).toHaveText(`Version ${maxRev}`);
    const dateLast = await parsedBannerDate(page);
    expect(Number.isNaN(dateLast)).toBe(false);
    // The mirrored timer must also be a real, non-NaN datetime.
    const timerLast = await page.locator('#history-timer').textContent();
    expect(Number.isNaN(new Date(timerLast || '').getTime())).toBe(false);

    // Scrub back to revision 0 — label and date must update.
    await goToRevision(page, 0);
    await expect(page.locator('#history-banner-rev')).toHaveText('Version 0');
    const dateFirst = await parsedBannerDate(page);
    expect(Number.isNaN(dateFirst)).toBe(false);
    // The latest revision is never older than revision 0.
    expect(dateLast).toBeGreaterThanOrEqual(dateFirst);
  });
});
