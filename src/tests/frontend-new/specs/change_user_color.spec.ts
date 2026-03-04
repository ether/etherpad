import {expect, test} from "@playwright/test";
import {goToNewPad, sendChatMessage, showChat} from "../helper/padHelper";

test.beforeEach(async ({page}) => {
    await goToNewPad(page);
})

test.describe('change user color', function () {

    test('Color picker matches original color and remembers the user color after a refresh',
        async function ({page}) {

            // click on the settings button to make settings visible
            let $userButton = page.locator('.buttonicon-showusers');
            await $userButton.click()

            let $userSwatch = page.locator('#myswatch');
            await $userSwatch.click()
            // Change the color value of the Farbtastic color picker

            const $colorPickerSave = page.locator('#mycolorpickersave');
            let $colorPickerPreview = page.locator('#mycolorpickerpreview');

            // Same color represented in two different ways
            const testColorHash = '#abcdef';
            const testColorRGB = 'rgb(171, 205, 239)';

            // Check that the color picker matches the automatically assigned random color on the swatch.
            // NOTE: This has a tiny chance of creating a false positive for passing in the
            // off-chance the randomly assigned color is the same as the test color.
            expect(await $colorPickerPreview.getAttribute('style')).toContain(await $userSwatch.getAttribute('style'));

            // The swatch updates as the test color is picked.
            await page.evaluate((testRGBColor) => {
                document.getElementById('mycolorpickerpreview')!.style.backgroundColor = testRGBColor;
            }, testColorRGB
            )

            await $colorPickerSave.click();

            // give it a second to save the color on the server side
            await page.waitForTimeout(1000)


            // get a new pad, but don't clear the cookies
            await goToNewPad(page)


            // click on the settings button to make settings visible
            await $userButton.click()

            await $userSwatch.click()



            expect(await $colorPickerPreview.getAttribute('style')).toContain(await $userSwatch.getAttribute('style'));
        });

    test('Own user color is shown when you enter a chat', async function ({page}) {

        const colorOption = page.locator('#options-colorscheck');
        if (!(await colorOption.isChecked())) {
            await colorOption.check();
        }

        // click on the settings button to make settings visible
        const $userButton = page.locator('.buttonicon-showusers');
        await $userButton.click()

        const $userSwatch = page.locator('#myswatch');
        await $userSwatch.click()

        const $colorPickerSave = page.locator('#mycolorpickersave');

        // Same color represented in two different ways
        const testColorHash = '#abcdef';
        const testColorRGB = 'rgb(171, 205, 239)';

        // The swatch updates as the test color is picked.
        await page.evaluate((testRGBColor) => {
                document.getElementById('mycolorpickerpreview')!.style.backgroundColor = testRGBColor;
            }, testColorRGB
        )


        await $colorPickerSave.click();
        // click on the chat button to make chat visible
        await showChat(page)
        await sendChatMessage(page, 'O hi');

        // wait until the chat message shows up
        const chatP = page.locator('#chattext').locator('p')
        const chatText = await chatP.innerText();

        expect(chatText).toContain('O hi');

        const color = await chatP.evaluate((el) => {
            return window.getComputedStyle(el).getPropertyValue('background-color');
        }, chatText);

        expect(color).toBe(testColorRGB);
    });
});
