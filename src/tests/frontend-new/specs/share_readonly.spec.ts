import {expect, test} from '@playwright/test';
import {getPadBody, goToNewPad} from '../helper/padHelper';

test.use({locale: 'en-US'});

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
  await page.locator('.buttonicon-embed').click();
  await expect(page.locator('#embed.popup-show')).toBeVisible();
});

test('explains that read-only sharing selects a link, not pad permissions', async ({page}) => {
  const checkbox = page.getByRole('checkbox', {name: 'Use read-only link', exact: true});
  const explanation = 'This only changes the link and embed code shown here. ' +
    'Keep the editable link to make changes; anyone with that link can still edit the pad.';
  await expect(checkbox).toBeAttached();
  await expect(page.locator('#readonly-explanation')).toHaveText(explanation);
  await expect(page.locator('#readonly-explanation')).toBeVisible();
  await expect(checkbox).toHaveAccessibleDescription(explanation);
  await expect(page.locator('label[for="readonlyinput"]')).toBeVisible();
});

test('switches share links without changing access through either link', async ({page, context}) => {
  const editableUrl = page.url();
  const checkbox = page.locator('#readonlyinput');
  const label = page.locator('label[for="readonlyinput"]');
  await expect(page.locator('#linkinput')).toHaveValue(editableUrl);
  await label.click();
  await expect(checkbox).toBeChecked();
  await expect(page.locator('#linkinput')).toHaveValue(/\/p\/r\./);
  const readonlyUrl = await page.locator('#linkinput').inputValue();
  expect(await page.locator('#embedinput').inputValue()).toContain(`src="${readonlyUrl}?`);
  await expect(page.locator('#embedinput')).toHaveValue(/name="embed_readonly"/);
  await expect(page).toHaveURL(editableUrl);
  await expect(await getPadBody(page)).toHaveAttribute('contenteditable', 'true');

  await label.click();
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator('#linkinput')).toHaveValue(editableUrl);
  await expect(page.locator('#embedinput')).toHaveValue(/name="embed_readwrite"/);

  const reader = await context.newPage();
  await reader.goto(readonlyUrl);
  await reader.waitForSelector('#editorcontainer.initialized');
  await expect(await getPadBody(reader)).toHaveAttribute('contenteditable', 'false');
  await reader.locator('.buttonicon-embed').click();
  await expect(reader.locator('#embed.popup-show')).toBeVisible();
  await expect(reader.locator('#embedreadonly')).toBeHidden();
  await expect(reader.locator('#linkinput')).toHaveValue(readonlyUrl);

  await page.reload();
  await page.waitForSelector('#editorcontainer.initialized');
  await expect(await getPadBody(page)).toHaveAttribute('contenteditable', 'true');
  await reader.close();
});
