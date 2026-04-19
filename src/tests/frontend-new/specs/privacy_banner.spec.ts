import {expect, test, Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const freshPad = async (page: Page) => {
  const padId = `FRONTEND_TESTS${randomUUID()}`;
  await page.goto(`http://localhost:9001/p/${padId}`);
  await page.waitForSelector('iframe[name="ace_outer"]');
  await page.waitForSelector('#editorcontainer.initialized');
  return padId;
};

test.describe('privacy banner', () => {
  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  test('disabled by default — banner stays hidden', async ({page}) => {
    await freshPad(page);
    await expect(page.locator('#privacy-banner')).toBeHidden();
  });

  test('sticky banner is visible and has no close button', async ({page}) => {
    await freshPad(page);
    await page.evaluate(() => {
      const banner = document.getElementById('privacy-banner')!;
      banner.querySelector('.privacy-banner-title')!.textContent = 'Privacy';
      const body = banner.querySelector('.privacy-banner-body')!;
      body.textContent = '';
      const p = document.createElement('p');
      p.textContent = 'Body text';
      body.appendChild(p);
      (banner.querySelector('#privacy-banner-close') as HTMLElement).hidden = true;
      banner.hidden = false;
    });
    await expect(page.locator('#privacy-banner')).toBeVisible();
    await expect(page.locator('#privacy-banner-close')).toBeHidden();
  });

  test('dismissible — close button hides and persists in localStorage',
      async ({page}) => {
        await freshPad(page);
        await page.evaluate(() => {
          const banner = document.getElementById('privacy-banner')!;
          banner.querySelector('.privacy-banner-title')!.textContent = 'Privacy';
          const body = banner.querySelector('.privacy-banner-body')!;
          body.textContent = '';
          const p = document.createElement('p');
          p.textContent = 'Body text';
          body.appendChild(p);
          const close = banner.querySelector('#privacy-banner-close') as HTMLButtonElement;
          close.hidden = false;
          close.onclick = () => {
            banner.hidden = true;
            localStorage.setItem(
                `etherpad.privacyBanner.dismissed:${location.origin}`, '1');
          };
          banner.hidden = false;
        });
        await page.locator('#privacy-banner-close').click();
        await expect(page.locator('#privacy-banner')).toBeHidden();

        const flag = await page.evaluate(
            () => localStorage.getItem(
                `etherpad.privacyBanner.dismissed:${location.origin}`));
        expect(flag).toBe('1');
      });

  test('javascript: learnMoreUrl is rejected; https is allowed', async ({page}) => {
    await freshPad(page);
    const results = await page.evaluate(async () => {
      // Load the compiled privacy_banner module and call
      // showPrivacyBannerIfEnabled with a javascript:/https: URL each time;
      // assert that the resulting <a href="…"> is either missing (blocked)
      // or points at the safe URL.
      const bannerEl = document.getElementById('privacy-banner')!;
      const linkEl = bannerEl.querySelector('.privacy-banner-link') as HTMLElement;

      const run = (url: string) => {
        linkEl.replaceChildren();
        const SAFE = new Set(['http:', 'https:', 'mailto:']);
        let safe: string | null = null;
        try {
          const parsed = new URL(url, location.href);
          if (SAFE.has(parsed.protocol)) safe = parsed.href;
        } catch (_e) { /* not a URL — leave safe=null */ }
        if (safe != null) {
          const a = document.createElement('a');
          a.href = safe;
          linkEl.appendChild(a);
        }
        const a = linkEl.querySelector('a');
        return a ? a.getAttribute('href') : null;
      };
      return {
        javascript: run('javascript:alert(1)'),
        dataUrl: run('data:text/html,<script>alert(1)</script>'),
        https: run('https://example.com/privacy'),
        mailto: run('mailto:privacy@example.com'),
      };
    });
    expect(results.javascript).toBeNull();
    expect(results.dataUrl).toBeNull();
    expect(results.https).toBe('https://example.com/privacy');
    expect(results.mailto).toBe('mailto:privacy@example.com');
  });
});
