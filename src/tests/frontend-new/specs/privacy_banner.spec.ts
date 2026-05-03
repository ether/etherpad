import {expect, test, Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

type BannerConfig = {
  enabled: boolean,
  title: string,
  body: string,
  learnMoreUrl: string | null,
  dismissal: 'dismissible' | 'sticky',
};

const STORAGE_PREFIX = 'etherpad.privacyBanner.dismissed:';
// All gritters render into #gritter-container.bottom for this feature; we tag
// our gritter with `class_name: 'privacy-notice'` so tests can target it
// regardless of whatever else the pad may surface.
const NOTICE = '#gritter-container.bottom .gritter-item.privacy-notice';

const freshPad = async (page: Page) => {
  const padId = `FRONTEND_TESTS${randomUUID()}`;
  await page.goto(`http://localhost:9001/p/${padId}`);
  await page.waitForSelector('iframe[name="ace_outer"]');
  await page.waitForSelector('#editorcontainer.initialized');
  // Drop any persisted dismissal flag from a previous test run on this origin
  // so dismissible scenarios start from a clean state regardless of order.
  await page.evaluate((prefix) => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) localStorage.removeItem(k);
    }
  }, STORAGE_PREFIX);
  return padId;
};

const showBanner = (page: Page, config: BannerConfig) =>
  page.evaluate((cfg) => {
    (window as any).__etherpad_privacyBanner__.show(cfg);
  }, config);

test.describe('privacy banner (gritter-based)', () => {
  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  test('disabled by default — no privacy gritter is shown', async ({page}) => {
    await freshPad(page);
    await expect(page.locator(NOTICE)).toHaveCount(0);
  });

  test('enabled=false leaves the page free of a privacy gritter', async ({page}) => {
    await freshPad(page);
    await showBanner(page, {
      enabled: false,
      title: 'Should not render',
      body: 'Should not render',
      learnMoreUrl: null,
      dismissal: 'sticky',
    });
    await expect(page.locator(NOTICE)).toHaveCount(0);
  });

  test('renders title, body paragraphs, and link as a sticky bottom gritter',
      async ({page}) => {
        await freshPad(page);
        await showBanner(page, {
          enabled: true,
          title: 'Privacy notice',
          body: 'First paragraph.\nSecond paragraph.',
          learnMoreUrl: 'https://example.com/privacy',
          dismissal: 'sticky',
        });
        const item = page.locator(NOTICE);
        await expect(item).toBeVisible();
        await expect(item).toHaveClass(/sticky/);
        await expect(item.locator('.gritter-title')).toHaveText('Privacy notice');
        // The body lines become two <p>s; the optional link adds a third.
        const paragraphs = item.locator('.gritter-content > p, .gritter-content div p');
        await expect(paragraphs).toHaveCount(3);
        await expect(paragraphs.nth(0)).toHaveText('First paragraph.');
        await expect(paragraphs.nth(1)).toHaveText('Second paragraph.');
        const link = item.locator('a');
        await expect(link).toHaveAttribute('href', 'https://example.com/privacy');
        await expect(link).toHaveAttribute('rel', 'noreferrer noopener');
        await expect(link).toHaveAttribute('target', '_blank');
      });

  test('dismissible — clicking gritter close persists flag in localStorage',
      async ({page}) => {
        await freshPad(page);
        await showBanner(page, {
          enabled: true,
          title: 'Privacy notice',
          body: 'Body.',
          learnMoreUrl: null,
          dismissal: 'dismissible',
        });
        const item = page.locator(NOTICE);
        await expect(item).toBeVisible();
        await item.locator('.gritter-close').click();
        await expect(page.locator(NOTICE)).toHaveCount(0);

        const flag = await page.evaluate(
            (prefix) => localStorage.getItem(`${prefix}${location.origin}`),
            STORAGE_PREFIX);
        expect(flag).toBe('1');
      });

  test('dismissible — pre-existing localStorage flag suppresses the gritter',
      async ({page}) => {
        await freshPad(page);
        await page.evaluate(
            (prefix) => localStorage.setItem(`${prefix}${location.origin}`, '1'),
            STORAGE_PREFIX);
        await showBanner(page, {
          enabled: true,
          title: 'Privacy notice',
          body: 'Body.',
          learnMoreUrl: null,
          dismissal: 'dismissible',
        });
        await expect(page.locator(NOTICE)).toHaveCount(0);
      });

  test('sticky — closing the gritter does NOT persist a dismissal flag',
      async ({page}) => {
        // sticky mode means "show on every load"; the close button still
        // works for the current session but must not store a flag.
        await freshPad(page);
        await showBanner(page, {
          enabled: true,
          title: 'Privacy notice',
          body: 'Body.',
          learnMoreUrl: null,
          dismissal: 'sticky',
        });
        const item = page.locator(NOTICE);
        await expect(item).toBeVisible();
        await item.locator('.gritter-close').click();
        await expect(page.locator(NOTICE)).toHaveCount(0);

        const flag = await page.evaluate(
            (prefix) => localStorage.getItem(`${prefix}${location.origin}`),
            STORAGE_PREFIX);
        expect(flag).toBeNull();
      });

  test('sticky — pre-existing localStorage flag is ignored',
      async ({page}) => {
        await freshPad(page);
        await page.evaluate(
            (prefix) => localStorage.setItem(`${prefix}${location.origin}`, '1'),
            STORAGE_PREFIX);
        await showBanner(page, {
          enabled: true,
          title: 'Privacy notice',
          body: 'Body.',
          learnMoreUrl: null,
          dismissal: 'sticky',
        });
        await expect(page.locator(NOTICE)).toBeVisible();
      });

  test('javascript: learnMoreUrl is rejected — no anchor rendered',
      async ({page}) => {
        await freshPad(page);
        await showBanner(page, {
          enabled: true,
          title: 'Privacy notice',
          body: 'Body.',
          learnMoreUrl: 'javascript:alert(1)',
          dismissal: 'sticky',
        });
        await expect(page.locator(`${NOTICE} a`)).toHaveCount(0);
      });

  test('data: learnMoreUrl is rejected — no anchor rendered', async ({page}) => {
    await freshPad(page);
    await showBanner(page, {
      enabled: true,
      title: 'Privacy notice',
      body: 'Body.',
      learnMoreUrl: 'data:text/html,<script>alert(1)</script>',
      dismissal: 'sticky',
    });
    await expect(page.locator(`${NOTICE} a`)).toHaveCount(0);
  });

  test('unknown dismissal value is treated as dismissible (defense-in-depth)',
      async ({page}) => {
        // Server-side reloadSettings() coerces unknown strings to
        // 'dismissible' with a warn, but the client guards too in case a
        // hot-reload or custom build path skips that validation.
        await freshPad(page);
        await showBanner(page, {
          enabled: true,
          title: 'Privacy notice',
          body: 'Body.',
          learnMoreUrl: null,
          dismissal: 'wat' as any,
        });
        const item = page.locator(NOTICE);
        await expect(item).toBeVisible();
        await item.locator('.gritter-close').click();
        await expect(page.locator(NOTICE)).toHaveCount(0);
        const flag = await page.evaluate(
            (prefix) => localStorage.getItem(`${prefix}${location.origin}`),
            STORAGE_PREFIX);
        expect(flag).toBe('1');
      });

  test('mailto: learnMoreUrl is allowed', async ({page}) => {
    await freshPad(page);
    await showBanner(page, {
      enabled: true,
      title: 'Privacy notice',
      body: 'Body.',
      learnMoreUrl: 'mailto:privacy@example.com',
      dismissal: 'sticky',
    });
    await expect(page.locator(`${NOTICE} a`))
        .toHaveAttribute('href', 'mailto:privacy@example.com');
  });
});
