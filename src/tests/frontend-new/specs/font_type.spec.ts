import {expect, test} from "@playwright/test";
import {getPadBody, goToNewPad} from "../helper/padHelper";
import {showSettings} from "../helper/settingsHelper";

test.beforeEach(async ({ page })=>{
    // create a new pad before each test run
    await goToNewPad(page);
})


test.describe('font select', function () {
    // create a new pad before each test run

    test('makes text RobotoMono', async function ({page}) {
        // click on the settings button to make settings visible
        await showSettings(page);

        // get the font menu and RobotoMono option
        const viewFontMenu = page.locator('#viewfontmenu');

        // select RobotoMono and fire change event
        // $RobotoMonooption.attr('selected','selected');
        // commenting out above will break safari test
        const dropdown = page.locator('.dropdowns-container .dropdown-line .current').nth(0)
        await dropdown.click()
        await page.locator('li:text("RobotoMono")').click()

        await viewFontMenu.dispatchEvent('change');
        const padBody = await getPadBody(page)
        const color = await padBody.evaluate((e) => {
            return window.getComputedStyle(e).getPropertyValue("font-family")
        })


        // check if font changed to RobotoMono
        const containsStr = color.toLowerCase().indexOf('robotomono');
        expect(containsStr).not.toBe(-1);
    });
});
