import {expect, test, Page} from '@playwright/test';
import {goToNewPad} from '../helper/padHelper';

const themeColor = (page: Page) =>
  page.locator('meta[name="theme-color"]').getAttribute('content');

test.describe('light color scheme', () => {
  test.use({colorScheme: 'light'});

  test('theme-color meta tracks the dark-mode toggle', async ({page}) => {
    await goToNewPad(page);
    // Server emits the light baseline derived from settings.skinVariants.
    expect(await themeColor(page)).toBe('#ffffff');

    await page.locator('button[data-l10n-id="pad.toolbar.settings.title"]').click();
    await expect(page.locator('#theme-toggle-row')).toBeVisible();

    // Colibris styles the native checkbox via a sibling label; click the label
    // so the toggle fires the real change event the production code listens on.
    await page.locator('label[for="options-darkmode"]').click();
    // pad.ts forces super-dark-toolbar (#485365) regardless of the configured
    // light skinVariants, so the meta must follow the client-applied class.
    await expect.poll(() => themeColor(page)).toBe('#485365');

    await page.locator('label[for="options-darkmode"]').click();
    await expect.poll(() => themeColor(page)).toBe('#ffffff');
  });
});

test.describe('dark color scheme', () => {
  test.use({colorScheme: 'dark'});

  test('theme-color meta follows the auto dark-mode switch on dark-OS clients',
    async ({page}) => {
      await goToNewPad(page);
      // pad.ts auto-switches to super-dark-toolbar when enableDarkMode is on,
      // matchMedia(prefers-color-scheme:dark) matches, and no localStorage
      // white-mode override is set. The meta must follow the applied class —
      // this is the case stffen reported on issue #7606.
      await expect.poll(() => themeColor(page)).toBe('#485365');
    });
});
