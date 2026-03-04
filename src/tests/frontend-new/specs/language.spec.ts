import {expect, test} from "@playwright/test";
import {getPadBody, goToNewPad} from "../helper/padHelper";
import {showSettings} from "../helper/settingsHelper";

test.beforeEach(async ({ page, browser })=>{
    const context = await browser.newContext()
    await context.clearCookies()
    await goToNewPad(page);
})



test.describe('Language select and change', function () {

    // Destroy language cookies
    test('makes text german', async function ({page}) {
        // click on the settings button to make settings visible
        await showSettings(page)

        // click the language button
        const languageDropDown  = page.locator('.nice-select').nth(1)

        await languageDropDown.click()
        await page.locator('.nice-select').locator('[data-value=de]').click()
        await expect(languageDropDown.locator('.current')).toHaveText('Deutsch')

        // select german
        await page.locator('.buttonicon-bold').evaluate((el) => el.parentElement!.title === 'Fett (Strg-B)');
    });

    test('makes text English', async function ({page}) {

        await showSettings(page)

        // click the language button
        await page.locator('.nice-select').nth(1).locator('.current').click()
        await page.locator('.nice-select').locator('[data-value=de]').click()

        // select german
        await page.locator('.buttonicon-bold').evaluate((el) => el.parentElement!.title === 'Fett (Strg-B)');


        // change to english
        await page.locator('.nice-select').nth(1).locator('.current').click()
        await page.locator('.nice-select').locator('[data-value=en]').click()

        // check if the language is now English
        await page.locator('.buttonicon-bold').evaluate((el) => el.parentElement!.title !== 'Fett (Strg-B)');
    });

    test('changes direction when picking an rtl lang', async function ({page}) {

        await showSettings(page)

        // click the language button
        await page.locator('.nice-select').nth(1).locator('.current').click()
        await page.locator('.nice-select').locator('[data-value=de]').click()

        // select german
        await page.locator('.buttonicon-bold').evaluate((el) => el.parentElement!.title === 'Fett (Strg-B)');

        // click the language button
        await page.locator('.nice-select').nth(1).locator('.current').click()
        // select arabic
        // $languageoption.attr('selected','selected'); // Breaks the test..
        await page.locator('.nice-select').locator('[data-value=ar]').click()

        await page.waitForSelector('html[dir="rtl"]')
    });

    test('changes direction when picking an ltr lang', async function ({page}) {
        await showSettings(page)

        // change to english
        const languageDropDown  = page.locator('.nice-select').nth(1)
        await languageDropDown.locator('.current').click()
        await languageDropDown.locator('[data-value=en]').click()

        await expect(languageDropDown.locator('.current')).toHaveText('English')

        // check if the language is now English
        await page.locator('.buttonicon-bold').evaluate((el) => el.parentElement!.title !== 'Fett (Strg-B)');


        await page.waitForSelector('html[dir="ltr"]')

    });
});
