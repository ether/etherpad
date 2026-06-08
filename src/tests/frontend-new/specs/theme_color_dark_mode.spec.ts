import {expect, test, Page} from '@playwright/test';
import {goToNewPad} from '../helper/padHelper';

// Issue #7606: the server emits a media-scoped pair of theme-color metas so
// iOS Safari can pick the right address-bar color at first paint without JS.
// Read each by its media attribute; the browser applies whichever matches the
// active color scheme.
const lightThemeColor = (page: Page) =>
  page.locator('meta[name="theme-color"][media="(prefers-color-scheme: light)"]')
    .getAttribute('content');
const darkThemeColor = (page: Page) =>
  page.locator('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]')
    .getAttribute('content');

test.describe('light color scheme', () => {
  test.use({colorScheme: 'light'});

  test('theme-color meta tracks the dark-mode toggle', async ({page}) => {
    await goToNewPad(page);
    // First paint: light baseline is active, and the dark variant is present
    // so a dark-OS client would have rendered #485365 without any JS.
    expect(await lightThemeColor(page)).toBe('#ffffff');
    expect(await darkThemeColor(page)).toBe('#485365');

    await page.locator('button[data-l10n-id="pad.toolbar.settings.title"]').click();
    await expect(page.locator('#theme-toggle-row')).toBeVisible();

    // Colibris styles the native checkbox via a sibling label; click the label
    // so the toggle fires the real change event the production code listens on.
    await page.locator('label[for="options-darkmode"]').click();
    // The explicit toggle points every theme-color meta at the dark toolbar
    // color, so the address bar goes dark even though the OS is in light mode.
    await expect.poll(() => lightThemeColor(page)).toBe('#485365');

    await page.locator('label[for="options-darkmode"]').click();
    await expect.poll(() => lightThemeColor(page)).toBe('#ffffff');
  });
});

test.describe('dark color scheme', () => {
  test.use({colorScheme: 'dark'});

  test('theme-color meta is dark at first paint on dark-OS clients',
    async ({page}) => {
      await goToNewPad(page);
      // The media-scoped dark variant is what fixes stffen's iPhone: it is
      // present and dark before any JS runs, so iOS Safari colors the address
      // bar correctly at parse time (issue #7606).
      await expect.poll(() => darkThemeColor(page)).toBe('#485365');
    });

  test('page paints dark without a light flash on dark-OS clients',
    async ({page}) => {
      await goToNewPad(page);
      // The inline pre-paint script in <head> adds the dark skin classes to
      // <html> before the stylesheet paints, so a dark-OS user never sees the
      // light page (issue #7606). Asserting the class is present confirms the
      // dark skin is applied; the backend test verifies the script is ordered
      // before pad.css so it takes effect at first paint.
      await expect(page.locator('html')).toHaveClass(/super-dark-editor/);
    });
});
