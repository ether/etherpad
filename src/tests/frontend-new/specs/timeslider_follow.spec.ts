'use strict';
import {expect, Page, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";
import {gotoTimeslider} from "../helper/timeslider";

test.beforeEach(async ({ page })=>{
    await goToNewPad(page);
})


test.describe('timeslider follow', function () {

    // TODO needs test if content is also followed, when user a makes edits
    // while user b is in the timeslider
    test("content as it's added to timeslider", async function ({page}) {
        // send 6 revisions
        const revs = 6;
        const message = 'a\n\n\n\n\n\n\n\n\n\n';
        const newLines = message.split('\n').length;
        for (let i = 0; i < revs; i++) {
            await writeToPad(page, message)
        }

        await gotoTimeslider(page,0);
        expect(page.url()).toContain('#0');

        const originalTop = await page.evaluate(() => {
            return window.document.querySelector('#innerdocbody')!.getBoundingClientRect().top;
        });

        // set to follow contents as it arrives
        await page.check('#options-followContents');
        await page.click('#playpause_button_icon');

        // wait for the scroll
        await page.waitForTimeout(1000)

        const currentOffset = await page.evaluate(() => {
            return window.document.querySelector('#innerdocbody')!.getBoundingClientRect().top;
        });

        expect(currentOffset).toBeLessThanOrEqual(originalTop);
    });

    /**
     * Tests for bug described in #4389
     * The goal is to scroll to the first line that contains a change right before
     * the change is applied.
     */
    test('only to lines that exist in the pad view, regression test for #4389', async function ({page}) {
        const padBody = await getPadBody(page)
        await padBody.click()

        await clearPadContent(page)

        await writeToPad(page,'Test line\n' +
            '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n' +
            '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n' +
            '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n');
        await padBody.locator('div').nth(40).click();
        await writeToPad(page, 'Another test line');


        await gotoTimeslider(page, 200);

        // set to follow contents as it arrives
        await page.check('#options-followContents');

        await page.waitForTimeout(1000)

        const oldYPosition = await page.locator('#editorcontainerbox').evaluate((el) => {
          return el.scrollTop;
        })
        expect(oldYPosition).toBe(0);
    });
});
