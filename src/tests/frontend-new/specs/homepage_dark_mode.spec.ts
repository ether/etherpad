import {test, expect} from '@playwright/test';

test.describe('Colibris home page dark mode', () => {
  test('follows changes to the browser color scheme without reloading', async ({page}) => {
    await page.emulateMedia({colorScheme: 'light'});
    await page.goto('http://localhost:9001/');
    const home = page.locator('.body');

    await expect(home).toHaveCSS('background-image', /^linear-gradient\(/);
    await page.emulateMedia({colorScheme: 'dark'});
    await expect(home).toHaveCSS('background-color', 'rgb(72, 83, 101)');
    await page.emulateMedia({colorScheme: 'light'});
    await expect(home).toHaveCSS('background-image', /^linear-gradient\(/);
  });

  test('honors the light mode preference saved in a pad', async ({page}) => {
    await page.emulateMedia({colorScheme: 'dark'});
    await page.addInitScript(() => localStorage.setItem('ep_darkMode', 'false'));
    await page.goto('http://localhost:9001/');

    await expect(page.locator('.body')).toHaveCSS('background-image', /^linear-gradient\(/);
  });
});
