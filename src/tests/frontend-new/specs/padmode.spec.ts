import {expect, test} from '@playwright/test';
import {clearPadContent, goToNewPad, writeToPad} from '../helper/padHelper.js';

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

    // The iframe mounted with the embedded timeslider markup; its own
    // editbar is hidden because the slider lives in the outer toolbar
    // (#history-controls).
    const frame = page.frameLocator('#history-frame');
    await expect(frame.locator('body.embedded-history-frame')).toBeVisible();
    await expect(frame.locator('#editbar')).toBeHidden();
    await expect(page.locator('#history-slider-input')).toBeVisible();
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
    // Accept 304 — Firefox issues a conditional GET because goToNewPad
    // already loaded the same URL and the response is identical.
    expect([200, 304]).toContain(res?.status());
  });

  // Phase B — chrome consolidation, chat replay, authors panel, exports.

  test('Follow + Playback speed are inline in the toolbar in history mode', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'one');
    await page.waitForTimeout(300);

    // Live mode: history-controls hidden, so Follow + Speed are not visible.
    await expect(page.locator('#history-options-followContents')).toBeHidden();
    await expect(page.locator('#history-playbackspeed')).toBeHidden();

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();

    // Both controls live inside #history-controls in the toolbar — no need
    // to open the Settings popup.
    await expect(page.locator('#history-controls #history-options-followContents'))
        .toBeAttached();
    await expect(page.locator('#history-controls #history-playbackspeed'))
        .toBeAttached();
  });

  test('embedded iframe shows only the editor surface (no inner editbar)', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'A');
    await page.waitForTimeout(300);

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();

    const frame = page.frameLocator('#history-frame');
    // The whole inner editbar is hidden — slider + play buttons live in
    // the outer pad's toolbar now (#history-controls). Iframe is editor.
    await expect(frame.locator('#editbar')).toBeHidden();
    // Editor body itself is still rendered.
    await expect(frame.locator('#outerdocbody')).toBeVisible();
  });

  test('outer toolbar swaps formatting menu for history controls', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'A');
    await page.waitForTimeout(300);

    // Live mode: history-controls is in DOM but hidden; menu_left visible.
    await expect(page.locator('#history-controls')).toBeHidden();
    await expect(page.locator('#editbar .menu_left')).toBeVisible();

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();

    // History mode: menu_left hidden, history-controls + slider visible.
    const leftDisplay = await page.locator('#editbar .menu_left').evaluate(
        (el) => getComputedStyle(el).display);
    expect(leftDisplay).toBe('none');
    await expect(page.locator('#history-controls')).toBeVisible();
    await expect(page.locator('#history-slider-input')).toBeVisible();
    // Right-side menu (Settings/Share/Users/Chat/Home) stays fully active.
    await expect(page.locator('button[data-l10n-id=\'pad.toolbar.settings.title\']'))
        .toBeVisible();
  });

  test('outer slider drives the embedded timeslider revision', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'one');
    await page.waitForTimeout(300);
    await writeToPad(page, ' two');
    await page.waitForTimeout(300);
    await writeToPad(page, ' three');
    await page.waitForTimeout(800);

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();
    // Wait until BroadcastSlider has populated the outer slider's max.
    await page.waitForFunction(() => {
      const i = document.getElementById('history-slider-input') as HTMLInputElement | null;
      return !!i && Number(i.max) > 0;
    }, {timeout: 10_000});

    // Move the outer slider to revision 0 and assert the iframe followed.
    await page.locator('#history-slider-input').evaluate((el: HTMLInputElement) => {
      el.value = '0';
      el.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await page.waitForFunction(() => {
      const f = document.getElementById('history-frame') as HTMLIFrameElement | null;
      const win: any = f && f.contentWindow;
      return !!win?.BroadcastSlider && win.BroadcastSlider.getSliderPosition() === 0;
    }, {timeout: 5_000});

    expect(page.url()).toMatch(/#rev\/0$/);
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

  test('line numbers align with each line of text in history mode', async ({page}) => {
    await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'one');
    await page.keyboard.press('Enter');
    await writeToPad(page, 'two');
    await page.keyboard.press('Enter');
    await writeToPad(page, 'three');
    await page.waitForTimeout(800);

    await page.locator('.buttonicon-history').click();
    await expect(page.locator('body.history-mode')).toBeVisible();

    // Wait for the iframe's broadcast.ts to populate #sidedivinner with
    // line-number children and align them to the editor body.
    const frame = page.frameLocator('#history-frame');
    await frame.locator('#sidediv.sidedivdelayed').waitFor({state: 'attached', timeout: 10_000});
    await page.waitForTimeout(500);

    const counts = await page.locator('#history-frame').evaluate((iframe: any) => {
      const idoc = iframe.contentDocument!;
      return {
        editorLines: idoc.querySelector('#innerdocbody')?.children.length ?? 0,
        gutterLines: idoc.querySelector('#sidedivinner')?.children.length ?? 0,
      };
    });
    expect(counts.editorLines).toBeGreaterThan(0);
    expect(counts.gutterLines).toBe(counts.editorLines);

    // Vertical alignment: every gutter row's top should match its
    // corresponding editor row's top within a small tolerance (line-height
    // rounding can introduce sub-pixel drift).
    const offsets = await page.locator('#history-frame').evaluate((iframe: any) => {
      const idoc = iframe.contentDocument!;
      const editor = [...idoc.querySelectorAll('#innerdocbody > div')];
      const gutter = [...idoc.querySelectorAll('#sidedivinner > div')];
      return editor.map((e: HTMLElement, i: number) => ({
        diff: Math.abs(e.offsetTop - (gutter[i] as HTMLElement).offsetTop),
      }));
    });
    for (const {diff} of offsets) {
      expect(diff).toBeLessThanOrEqual(2);
    }
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
