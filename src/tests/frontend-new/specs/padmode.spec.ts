import {expect, test} from '@playwright/test';
import {clearPadContent, goToNewPad, writeToPad} from '../helper/padHelper';

// Issue #7659 — in-pad history mode.
//
// The pad and timeslider used to be on different URLs. Clicking the history
// toolbar button now keeps the user on the same URL and toggles a hash-based
// state instead. This spec exercises the entry, exit, direct-load, and
// browser-back paths, and asserts the rendered (localized) banner string
// rather than just element presence.

test.describe('in-pad history mode', () => {
  test('toolbar button enters history without leaving the pad URL', async ({page}) => {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'Hello');
    await page.waitForTimeout(500);
    await writeToPad(page, ' world');
    await page.waitForTimeout(500);

    const padPath = new URL(page.url()).pathname;

    await page.locator('.buttonicon-history').click();

    await expect(page.locator('body.history-mode')).toBeVisible();
    const banner = page.locator('#history-banner');
    await expect(banner).toBeVisible();

    // Banner is localized — assert the rendered string, not just presence.
    await expect(banner.locator('.history-banner-label'))
        .toHaveText('Viewing history');
    await expect(banner.locator('#history-banner-return'))
        .toHaveText('Return to live');

    // Pathname unchanged; only the hash is added.
    expect(new URL(page.url()).pathname).toBe(padPath);
    expect(page.url()).toMatch(/#rev\//);

    // The iframe mounted with the embedded timeslider markup.
    const frame = page.frameLocator('#history-frame');
    await expect(frame.locator('#timeslider-wrapper')).toBeVisible();
    await expect(frame.locator('body.embedded-history-frame')).toBeVisible();
    expect(padId).toBeTruthy();
  });

  test('Return-to-live exits history and clears the hash', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'A');
    await page.waitForTimeout(300);
    await writeToPad(page, 'B');
    await page.waitForTimeout(300);

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();

    await page.locator('#history-banner-return').click();
    await expect(page.locator('body.history-mode')).toHaveCount(0);
    await expect(page.locator('#history-banner')).toBeHidden();
    expect(new URL(page.url()).hash).toBe('');
  });

  test('browser back exits history mode', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'X');
    await page.waitForTimeout(300);

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();

    await page.goBack();
    await expect(page.locator('body.history-mode')).toHaveCount(0);
    await expect(page.locator('#history-banner')).toBeHidden();
  });

  test('legacy /p/:pad/timeslider URL redirects to the pad page', async ({page}) => {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'Y');
    await page.waitForTimeout(300);

    const res = await page.goto(`http://localhost:9001/p/${padId}/timeslider`);
    // Final landing URL is the pad page, not /timeslider.
    expect(new URL(page.url()).pathname).toBe(`/p/${padId}`);
    expect(res?.status()).toBe(200);
  });

  // Phase B — chrome consolidation, chat replay, authors panel, exports.

  test('outer Settings popup exposes history-only controls in history mode', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'one');
    await page.waitForTimeout(300);

    // Settings popup needs to be opened to assess section visibility, since
    // the popup itself is display:none until a class is toggled. Open it
    // and assert the history section is hidden in live mode.
    await page.locator('button[data-l10n-id=\'pad.toolbar.settings.title\']').click();
    await page.waitForFunction(() => document.querySelector('#settings')?.classList.contains('popup-show'));
    const liveDisplay = await page.locator('#history-settings-section').evaluate(
        (el) => getComputedStyle(el).display);
    expect(liveDisplay).toBe('none');

    // Close settings, enter history, reopen — section should now display.
    await page.keyboard.press('Escape');
    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();
    await page.locator('button[data-l10n-id=\'pad.toolbar.settings.title\']').click();
    await page.waitForFunction(() => document.querySelector('#settings')?.classList.contains('popup-show'));
    const histDisplay = await page.locator('#history-settings-section').evaluate(
        (el) => getComputedStyle(el).display);
    expect(histDisplay).not.toBe('none');
    await expect(page.locator('#history-options-followContents')).toBeAttached();
    await expect(page.locator('#history-playbackspeed')).toBeAttached();
  });

  test('history-mode hides the embedded timeslider chrome', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'A');
    await page.waitForTimeout(300);

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();

    const frame = page.frameLocator('#history-frame');
    // Slider stays visible; the right-side toolbar (settings/export/return)
    // and modal popups are hidden — outer pad owns those affordances.
    await expect(frame.locator('#timeslider-wrapper')).toBeVisible();
    await expect(frame.locator('.editbarright')).toBeHidden();
    await expect(frame.locator('.timeslider-title-container')).toBeHidden();
  });

  test('outer toolbar hides editing buttons but keeps menu_right active', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'A');
    await page.waitForTimeout(300);

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();

    // Formatting buttons live in #editbar .menu_left — they target the
    // hidden live editor and would do nothing useful, so they're hidden
    // (visibility:hidden so the layout stays stable).
    const leftVisibility = await page.locator('#editbar .menu_left').evaluate(
        (el) => getComputedStyle(el).visibility);
    expect(leftVisibility).toBe('hidden');
    // Right-side menu (Settings/Share/Users/Chat/Home) stays fully active.
    await expect(page.locator('button[data-l10n-id=\'pad.toolbar.settings.title\']'))
        .toBeVisible();
    const rightVisibility = await page.locator('#editbar .menu_right').evaluate(
        (el) => getComputedStyle(el).visibility);
    expect(rightVisibility).toBe('visible');
  });

  test('embedded slider sits at the bottom of the iframe viewport', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'A');
    await page.waitForTimeout(300);

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();
    await page.waitForTimeout(700);

    // The embed CSS pins #editbar to the bottom of the iframe so the
    // outer banner and the slider never visually compete for the same
    // band of pixels. Verify by reading geometry.
    const offset = await page.locator('#history-frame').evaluate((iframe: any) => {
      const idoc = iframe.contentDocument!;
      const editbar = idoc.getElementById('editbar') as HTMLElement;
      const r = editbar.getBoundingClientRect();
      return {
        bottomFromViewport: idoc.defaultView!.innerHeight - r.bottom,
        position: getComputedStyle(editbar).position,
      };
    });
    expect(offset.position).toBe('fixed');
    expect(Math.abs(offset.bottomFromViewport)).toBeLessThanOrEqual(2);
  });

  test('dark mode propagates into the history iframe', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'A');
    await page.waitForTimeout(300);

    // Apply dark-mode skin tokens directly to the outer <html>; this
    // mirrors what the dark-mode checkbox does at runtime. The iframe
    // should inherit them on first paint via timeslider.ts's
    // parent-class lookup.
    await page.evaluate(() => {
      const html = document.documentElement;
      ['super-dark-editor', 'dark-background', 'super-dark-toolbar']
          .forEach((c) => html.classList.add(c));
    });

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();
    await page.waitForTimeout(800);

    const innerClasses = await page.locator('#history-frame').evaluate(
        (iframe: any) => iframe.contentDocument!.documentElement.className);
    expect(innerClasses).toMatch(/super-dark-editor/);
    expect(innerClasses).toMatch(/dark-background/);
    expect(innerClasses).toMatch(/super-dark-toolbar/);
  });

  test('chat panel is filtered to messages newer than the historical revision', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'rev1');
    await page.waitForTimeout(400);

    // Inject two chat messages with controlled timestamps so we can assert
    // filtering deterministically without driving the chat widget. The chat
    // panel is closed by default so we read display style directly rather
    // than relying on Playwright's visibility (which considers ancestors).
    await page.evaluate(() => {
      const ct = document.getElementById('chattext')!;
      const earlier = document.createElement('p');
      earlier.setAttribute('data-timestamp', String(Date.now() - 60_000));
      earlier.classList.add('chat-msg-test-earlier');
      earlier.textContent = 'old';
      const later = document.createElement('p');
      later.setAttribute('data-timestamp', String(Date.now() + 60_000));
      later.classList.add('chat-msg-test-later');
      later.textContent = 'future';
      ct.append(earlier, later);
    });

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();
    // Wait for the inner BroadcastSlider hook to fire at least once.
    await page.waitForFunction(() => {
      const p = document.querySelector('.chat-msg-test-later') as HTMLElement | null;
      return !!p && p.style.display === 'none';
    }, {timeout: 10_000});

    // Earlier message has its inline display cleared (still rendered);
    // later message has display:none injected by the filter.
    const earlierDisplay = await page.locator('.chat-msg-test-earlier').evaluate(
        (el) => (el as HTMLElement).style.display);
    expect(earlierDisplay).not.toBe('none');
    const laterDisplay = await page.locator('.chat-msg-test-later').evaluate(
        (el) => (el as HTMLElement).style.display);
    expect(laterDisplay).toBe('none');
    // Chat replay header has the localized prefix.
    const headerText = await page.locator('#history-chat-header').textContent();
    expect(headerText).toMatch(/Chat as of/);
  });

  test('outer Export hrefs point at the historical revision in history mode', async ({page}) => {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'one');
    await page.waitForTimeout(400);
    await writeToPad(page, ' two');
    await page.waitForTimeout(800);

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();
    await page.waitForTimeout(700);

    const href = await page.locator('#exporthtmla').getAttribute('href');
    expect(href).not.toBeNull();
    // Format is /p/<padId>/<rev>/export/html — assert the revision segment.
    expect(href).toMatch(new RegExp(`/p/${padId}/\\d+/export/html`));

    await page.locator('#history-banner-return').click();
    await expect(page.locator('body.history-mode')).toHaveCount(0);
    const restored = await page.locator('#exporthtmla').getAttribute('href');
    expect(restored).toMatch(new RegExp(`/p/${padId}/export/html$`));
  });

  test('users panel shows authors-at-this-revision in history mode', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'hello');
    await page.waitForTimeout(400);

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();
    await page.waitForTimeout(700);

    // The authors row replaces the live-users table contents while in
    // history mode. Restored on exit.
    const tbl = page.locator('#otheruserstable');
    await expect(tbl.locator('.history-authors-row')).toBeAttached();

    await page.locator('#history-banner-return').click();
    await expect(page.locator('body.history-mode')).toHaveCount(0);
    await expect(tbl.locator('.history-authors-row')).toHaveCount(0);
  });
});
