import {expect, test} from "@playwright/test";
import {loginToAdmin, saveSettings, restartEtherpad} from "../helper/adminhelper";

// /admin tests run serially because they mutate global server state.
test.describe.configure({mode: 'serial'});

const ADMIN_URL = 'http://localhost:9001/admin';

const setErasureFlag = async (page: any, enabled: boolean) => {
  await page.goto(`${ADMIN_URL}/settings`);
  await page.waitForSelector('.settings');
  const settings = page.locator('.settings');
  await expect(settings).not.toHaveValue('', {timeout: 30000});
  const raw = await settings.inputValue();
  // The textarea exposes the raw settings.json — JSONC with comments,
  // trailing commas, and unquoted property names. JSON.parse rejects
  // all three. Evaluating it as a JS object literal (which it always
  // is) accepts everything Etherpad's own settings loader does.
  const obj = new Function(`return (${raw})`)();
  obj.gdprAuthorErasure = {enabled};
  await settings.fill(JSON.stringify(obj));
  await saveSettings(page);
  // settings.json save does not hot-reload — the server keeps the prior
  // in-memory `settings.gdprAuthorErasure.enabled` until restart, so a
  // subsequent navigation would still see the old flag value pushed via
  // the `flags` field on the connect-time settings reply. Restart so
  // tests observing the flag flip see the new value.
  await restartEtherpad(page);
  await loginToAdmin(page, 'admin', 'changeme1');
};

test.describe('admin authors page', () => {
  test.beforeEach(async ({page}) => {
    await loginToAdmin(page, 'admin', 'changeme1');
  });

  test('renders the localized page title', async ({page}) => {
    await page.goto(`${ADMIN_URL}/authors`);
    await expect(page.getByRole('heading', {name: 'Authors'}))
        .toBeVisible({timeout: 30000});
  });

  test('search filters the table to a matching author', async ({page}) => {
    const tag = `pw-${Date.now()}`;
    await page.goto(`${ADMIN_URL}/authors`);
    await page.waitForSelector('table');
    const search = page.getByPlaceholder('Search by name or mapper');
    await search.fill(tag);
    await expect(page.getByText('No authors match this search.'))
        .toBeVisible({timeout: 5000});
  });

  test('disabled banner shows when gdprAuthorErasure.enabled = false',
      async ({page}) => {
        await setErasureFlag(page, false);
        await page.goto(`${ADMIN_URL}/authors`);
        await expect(page.getByRole('alert'))
            .toContainText('Author erasure is disabled.', {timeout: 30000});
      });

  test('disabled banner is hidden when gdprAuthorErasure.enabled = true',
      async ({page}) => {
        await setErasureFlag(page, true);
        await page.goto(`${ADMIN_URL}/authors`);
        await page.waitForSelector('table');
        await expect(page.getByRole('alert')).toHaveCount(0);
      });

  test.afterAll(async ({browser}) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await loginToAdmin(page, 'admin', 'changeme1');
      await setErasureFlag(page, false);
    } finally {
      await ctx.close();
    }
  });
});
