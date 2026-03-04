import {expect, test} from "@playwright/test";
import {randomInt} from "node:crypto";
import {getPadBody, goToNewPad, selectAllText} from "../helper/padHelper";
import exp from "node:constants";

test.beforeEach(async ({ page })=>{
    await goToNewPad(page);
})

test.describe('bold button', ()=>{

    test('makes text bold on click', async ({page}) => {
// get the inner iframe
        const innerFrame = await getPadBody(page);

        await innerFrame.click()
        // Select pad text
        await selectAllText(page);
        await page.keyboard.type("Hi Etherpad");
        await selectAllText(page);

        // click the bold button
        await page.locator("button[data-l10n-id='pad.toolbar.bold.title']").click();


        // check if the text is bold
        expect(await innerFrame.locator('b').innerText()).toBe('Hi Etherpad');
    })

    test('makes text bold on keypress', async ({page}) => {
        // get the inner iframe
        const innerFrame = await getPadBody(page);

        await innerFrame.click()
        // Select pad text
        await selectAllText(page);
        await page.keyboard.type("Hi Etherpad");
        await selectAllText(page);

        // Press CTRL + B
        await page.keyboard.down('Control');
        await page.keyboard.press('b');
        await page.keyboard.up('Control');


        // check if the text is bold
        expect(await innerFrame.locator('b').innerText()).toBe('Hi Etherpad');
    })

})
