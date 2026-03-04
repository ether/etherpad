'use strict';

import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
    await goToNewPad(page);
})

test.describe('height regression after ace.js refactoring', function () {

    test('clientHeight should equal scrollHeight with few lines', async function ({page}) {
        const padBody = await getPadBody(page);
        await padBody.click()
        await clearPadContent(page)

        const iframe = page.locator('iframe').first()
        const scrollHeight =  await iframe.evaluate((element) => {
            return element.scrollHeight;
        })

        const clientHeight =  await iframe.evaluate((element) => {
            return element.clientHeight;
        })


        expect(clientHeight).toEqual(scrollHeight);
    });

    test('client height should be less than scrollHeight with many lines', async function ({page}) {
        const padBody = await getPadBody(page);
        await padBody.click()
        await clearPadContent(page)

        await writeToPad(page,'Test line\n' +
            '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n' +
            '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n' +
            '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n' +
            '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n' +
            '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n' +
            '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n' +
            '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n');

        const iframe = page.locator('iframe').first()
        const scrollHeight =  await iframe.evaluate((element) => {
            return element.scrollHeight;
        })

        const clientHeight =  await iframe.evaluate((element) => {
            return element.clientHeight;
        })

        // Need to poll because the heights take some time to settle.
        expect(clientHeight).toBeLessThanOrEqual(scrollHeight);
    });
});
