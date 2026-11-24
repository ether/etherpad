import {expect, Page, test} from '@playwright/test';
import {randomUUID} from 'node:crypto';

// Regression test for https://github.com/ether/etherpad/issues/8513
//
// A pad embedded in an iframe on another site, over plain http, can't use
// cookies: in a cross-site iframe the cookies are set with SameSite=None, which
// browsers reject without Secure, and Secure can't be set over http. The pad
// must still load and fall back to default prefs.
//
// The embedded tests are tagged @feature:cross-origin-embed so plugins that
// forbid framing on other origins (e.g. ep_helmet's X-Frame-Options) can
// declare it (see doc/PLUGIN_FEATURE_DISABLES.md). The untagged test below
// loads the embedding page, and loads the pad and changes the same pref at top
// level, so a plugin that declares the tag still runs those parts. What only
// the tagged tests cover is the framed pad and its cookie-less pref fallback.

const embedderUrl = 'http://127.0.0.1:9001/static/empty.html';
const newPadUrl = () => `http://localhost:9001/p/FRONTEND_TESTS${randomUUID()}`;

const embedPadCrossSite = async (page: Page) => {
  // 127.0.0.1 and localhost are different sites, so embedding a localhost pad
  // in a 127.0.0.1 page is a cross-site embed.
  await page.goto(embedderUrl);
  const padUrl = newPadUrl();
  await page.evaluate((src) => {
    const iframe = document.createElement('iframe');
    iframe.id = 'pad';
    iframe.src = src;
    iframe.width = '1000';
    iframe.height = '700';
    document.body.appendChild(iframe);
  }, padUrl);

  const pad = page.frameLocator('#pad');
  const outer = pad.frameLocator('iframe[name="ace_outer"]');
  const inner = outer.frameLocator('iframe');
  await expect(inner.locator('#innerdocbody')).toBeVisible({timeout: 30000});
  await expect(inner.locator('#innerdocbody')).toHaveAttribute('contenteditable', 'true');
  return {pad, outer};
};

test('the embedding page loads, and the pad loads and changes a pref at top level',
    async ({page}) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      expect((await page.goto(embedderUrl))!.ok()).toBe(true);
      await page.goto(newPadUrl());
      const inner = page.frameLocator('iframe[name="ace_outer"]').frameLocator('iframe');
      await expect(inner.locator('#innerdocbody')).toBeVisible({timeout: 30000});
      await expect(inner.locator('#innerdocbody')).toHaveAttribute('contenteditable', 'true');

      const fontMenu = page.locator('#viewfontmenu');
      await fontMenu.evaluate((el: HTMLSelectElement) => {
        el.value = 'RobotoMono';
        el.dispatchEvent(new Event('change'));
      });
      await expect(fontMenu).toHaveValue('RobotoMono');
      await expect(inner.locator('#innerdocbody')).toHaveCSS('font-family', /RobotoMono/);

      expect(pageErrors).toEqual([]);
    });

test.describe('pad embedded cross-site over http', {tag: '@feature:cross-origin-embed'}, () => {
  test('loads even though the prefs cookie cannot be stored', async ({page}) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await embedPadCrossSite(page);

    expect(pageErrors).toEqual([]);
  });

  // Uses the font pref because no other feature tag covers it, so the only
  // feature this test can fail for is the embed itself.
  test('changing a pref works even though the prefs cookie cannot be stored', async ({page}) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const {pad, outer} = await embedPadCrossSite(page);

    // Changing a pref writes to padcookie; that must not throw, and the
    // in-memory fallback must keep the new value.
    const fontMenu = pad.locator('#viewfontmenu');
    await fontMenu.evaluate((el: HTMLSelectElement) => {
      el.value = 'RobotoMono';
      el.dispatchEvent(new Event('change'));
    });
    await expect(fontMenu).toHaveValue('RobotoMono');
    await expect(outer.frameLocator('iframe').locator('#innerdocbody'))
        .toHaveCSS('font-family', /RobotoMono/);

    expect(pageErrors).toEqual([]);
  });
});
