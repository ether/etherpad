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
})
