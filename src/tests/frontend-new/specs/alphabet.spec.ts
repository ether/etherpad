import {expect, Page, test} from "@playwright/test";
import {clearPadContent, getPadBody, getPadOuter, goToNewPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
    // create a new pad before each test run
    await goToNewPad(page);
})

test.describe('All the alphabet works n stuff', () => {
    const expectedString = 'abcdefghijklmnopqrstuvwxyz';

    test('when you enter any char it appears right', async ({page}) => {

        // get the inner iframe
        const innerFrame =  await getPadBody(page!);

        await innerFrame.click();

        // delete possible old content
        await clearPadContent(page!);


        await page.keyboard.type(expectedString);
        const text = await innerFrame.locator('div').innerText();
        expect(text).toBe(expectedString);
    });
});
