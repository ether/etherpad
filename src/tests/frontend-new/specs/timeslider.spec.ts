import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
    // create a new pad before each test run
    await goToNewPad(page);
})


// deactivated, we need a nice way to get the timeslider, this is ugly
test.describe('timeslider button takes you to the timeslider of a pad', function () {

    test('timeslider contained in URL', async function ({page}) {
        const padBody = await getPadBody(page);
        await clearPadContent(page)
        await writeToPad(page, 'Foo'); // send line 1 to the pad

        // get the first text element inside the editable space
        const $firstTextElement = padBody.locator('div span').first();
        const originalValue = await $firstTextElement.textContent(); // get the original value
        await $firstTextElement.click()
        await writeToPad(page, 'Testing'); // send line 1 to the pad

        const modifiedValue = await $firstTextElement.textContent(); // get the modified value
        expect(modifiedValue).not.toBe(originalValue); // expect the value to change

        const $timesliderButton = page.locator('.buttonicon-history');
        await $timesliderButton.click(); // So click the timeslider link

        await page.waitForSelector('#timeslider-wrapper')

        const iFrameURL = page.url(); // get the url
        const inTimeslider = iFrameURL.indexOf('timeslider') !== -1;

        expect(inTimeslider).toBe(true); // expect the value to change
    });
});
