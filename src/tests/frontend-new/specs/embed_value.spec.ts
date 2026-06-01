import {expect, Page, test} from "@playwright/test";
import {goToNewPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
  // create a new pad before each test run
  await goToNewPad(page);
})

test.describe('embed links', function () {
  const objectify = function (str: string) {
    const hash = {};
    const parts = str.split('&');
    for (let i = 0; i < parts.length; i++) {
      const keyValue = parts[i].split('=');
      // @ts-ignore
      hash[keyValue[0]] = keyValue[1];
    }
    return hash;
  };

  const checkiFrameCode = async function (embedCode: string, readonly: boolean, page: Page) {
    // turn the code into an html element

    await page.setContent(embedCode, {waitUntil: 'load'})
    const locator = page.locator('body').locator('iframe').last()


    // read and check the frame attributes
    const width = await locator.getAttribute('width');
    const height = await locator.getAttribute('height');
    const name = await locator.getAttribute('name');
    expect(width).toBe('100%');
    expect(height).toBe('600');
    expect(name).toBe(readonly ? 'embed_readonly' : 'embed_readwrite');

    // parse the url
    const src = (await locator.getAttribute('src'))!;
    const questionMark = src.indexOf('?');
    const url = src.substring(0, questionMark);
    const paramsStr = src.substring(questionMark + 1);
    const params = objectify(paramsStr);

    const expectedParams = {
      showControls: 'true',
      showChat: 'true',
      showLineNumbers: 'true',
      useMonospaceFont: 'false',
    };

    // check the url
    if (readonly) {
      expect(url.indexOf('r.') > 0).toBe(true);
    } else {
      expect(url).toBe(await page.evaluate(() => window.location.href));
    }

    // check if all parts of the url are like expected
    expect(params).toEqual(expectedParams);
  };

  test.describe('read and write', function () {
    test.beforeEach(async ({ page })=>{
      // create a new pad before each test run
      await goToNewPad(page);
    })
      test('the share link is the actual pad url', async function ({page}) {

        const shareButton = page.locator('.buttonicon-embed')
        // open share dropdown
        await shareButton.click()

        // get the link of the share field + the actual pad url and compare them
        const shareLink = await page.locator('#linkinput').inputValue()
        const padURL = page.url();
        expect(shareLink).toBe(padURL);
      });

    test('is an iframe with the correct url parameters and correct size', async function ({page}) {

        const shareButton = page.locator('.buttonicon-embed')
        await shareButton.click()

        // get the link of the share field + the actual pad url and compare them
        const embedCode = await page.locator('#embedinput').inputValue()


        await checkiFrameCode(embedCode, false, page);
      });
  });

  test.describe('when read only option is set', function () {
    test.beforeEach(async ({ page })=>{
      // create a new pad before each test run
      await goToNewPad(page);
    })

      test('the share link shows a read only url', async function ({page}) {

        // open share dropdown
        const shareButton = page.locator('.buttonicon-embed')
        await shareButton.click()
        const readonlyCheckbox = page.locator('#readonlyinput')
        await readonlyCheckbox.click({
          force: true
        })
        await page.waitForSelector('#readonlyinput:checked')

        // get the link of the share field + the actual pad url and compare them
        const shareLink = await page.locator('#linkinput').inputValue()
        const containsReadOnlyLink = shareLink.indexOf('r.') > 0;
        expect(containsReadOnlyLink).toBe(true);
      });

      test('the embed as iframe code is an iframe with the correct url parameters and correct size', async function ({page}) {


        // open share dropdown
        const shareButton = page.locator('.buttonicon-embed')
        await shareButton.click()

        // check read only checkbox, a bit hacky
        const readonlyCheckbox = page.locator('#readonlyinput')
        await readonlyCheckbox.click({
          force: true
        })

        await page.waitForSelector('#readonlyinput:checked')


        // get the link of the share field + the actual pad url and compare them
        const embedCode = await page.locator('#embedinput').inputValue()

        await checkiFrameCode(embedCode, true, page);
      });
  })

  test.describe('UI interactions and accessibility', function () {
    test.beforeEach(async ({ page }) => {
      await goToNewPad(page);
    });

    test('focuses the dialog container on open', async function ({page}) {
      const shareButton = page.locator('button[data-l10n-id="pad.toolbar.embed.title"]');
      await shareButton.click();

      const dialog = page.locator('#embed');
      await expect(dialog).toBeFocused();
    });

    test('clicking inside inputs selects the entire text content', async function ({page}) {
      const shareButton = page.locator('button[data-l10n-id="pad.toolbar.embed.title"]');
      await shareButton.click();

      // Focus another element first to clear selection/focus
      const embedInput = page.locator('#embedinput');
      await embedInput.click();

      // Verify embedinput is fully selected on click
      let selection = await page.evaluate(() => {
        const activeEl = document.activeElement as HTMLInputElement;
        return {
          id: activeEl?.id,
          selectionStart: activeEl?.selectionStart,
          selectionEnd: activeEl?.selectionEnd,
          valueLength: activeEl?.value.length,
        };
      });
      expect(selection.id).toBe('embedinput');
      expect(selection.selectionStart).toBe(0);
      expect(selection.selectionEnd).toBe(selection.valueLength);

      // Now click linkinput
      const linkInput = page.locator('#linkinput');
      await linkInput.click();

      selection = await page.evaluate(() => {
        const activeEl = document.activeElement as HTMLInputElement;
        return {
          id: activeEl?.id,
          selectionStart: activeEl?.selectionStart,
          selectionEnd: activeEl?.selectionEnd,
          valueLength: activeEl?.value.length,
        };
      });
      expect(selection.id).toBe('linkinput');
      expect(selection.selectionStart).toBe(0);
      expect(selection.selectionEnd).toBe(selection.valueLength);
    });

    test('Escape key closes the dialog and restores focus to the trigger', async function ({page}) {
      const shareButton = page.locator('button[data-l10n-id="pad.toolbar.embed.title"]');
      await shareButton.click();

      const dialog = page.locator('#embed');
      await expect(dialog).toHaveClass(/popup-show/);
      // Wait for focus to land on the dialog to prevent any asynchronous race conditions under load
      await expect(dialog).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(dialog).not.toHaveClass(/popup-show/);

      // Verify focus is restored to the share button
      const focusedL10nId = await page.evaluate(() => document.activeElement?.getAttribute('data-l10n-id') || '');
      expect(focusedL10nId).toBe('pad.toolbar.embed.title');
    });

    test('bi-directional checkbox toggling updates links accordingly', async function ({page}) {
      const shareButton = page.locator('button[data-l10n-id="pad.toolbar.embed.title"]');
      await shareButton.click();

      const linkInput = page.locator('#linkinput');
      const embedInput = page.locator('#embedinput');
      const readonlyCheckbox = page.locator('#readonlyinput');

      // Unchecked by default: should be read-write
      const initialLink = await linkInput.inputValue();
      const initialEmbed = await embedInput.inputValue();
      expect(initialLink.indexOf('r.') > 0).toBe(false);
      expect(initialEmbed.indexOf('r.') > 0).toBe(false);

      // Check it -> updates to read-only
      await readonlyCheckbox.click({force: true});
      await page.waitForSelector('#readonlyinput:checked');
      const roLink = await linkInput.inputValue();
      const roEmbed = await embedInput.inputValue();
      expect(roLink.indexOf('r.') > 0).toBe(true);
      expect(roEmbed.indexOf('embed_readonly') > 0).toBe(true);

      // Uncheck it -> updates back to read-write
      await readonlyCheckbox.click({force: true});
      await page.waitForSelector('#readonlyinput:not(:checked)');
      const rwLink = await linkInput.inputValue();
      const rwEmbed = await embedInput.inputValue();
      expect(rwLink).toBe(initialLink);
      expect(rwEmbed).toBe(initialEmbed);
    });
  });
})
