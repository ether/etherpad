import {expect, test} from "@playwright/test";
import {clearPadContent, getPadBody, goToNewPad, writeToPad} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
    await goToNewPad(page);
})

test.describe('entering a URL makes a link', function () {
    for (const url of ['https://etherpad.org', 'www.etherpad.org', 'https://www.etherpad.org']) {
        test(url, async function ({page}) {
            const padBody = await getPadBody(page);
            await clearPadContent(page)
            const url = 'https://etherpad.org';
            await writeToPad(page, url);
            await expect(padBody.locator('div').first()).toHaveText(url);
            await expect(padBody.locator('a')).toHaveText(url);
            await expect(padBody.locator('a')).toHaveAttribute('href', url);
        });
    }
});


test.describe('special characters inside URL', async function () {
    for (const char of '-:@_.,~%+/?=&#!;()[]$\'*') {
        const url = `https://etherpad.org/${char}foo`;
        test(url, async function ({page}) {
            const padBody = await getPadBody(page);
            await clearPadContent(page)
            await padBody.click()
            await clearPadContent(page)
            await writeToPad(page, url);
            await expect(padBody.locator('div').first()).toHaveText(url);
            await expect(padBody.locator('a')).toHaveText(url);
            await expect(padBody.locator('a')).toHaveAttribute('href', url);
        });
    }
});

test.describe('punctuation after URL is ignored', ()=> {
    for (const char of ':.,;?!)]\'*') {
        const want = 'https://etherpad.org';
        const input = want + char;
        test(input, async function ({page}) {
            const padBody = await getPadBody(page);
            await clearPadContent(page)
            await writeToPad(page, input);
            await expect(padBody.locator('a')).toHaveCount(1);
            await expect(padBody.locator('a')).toHaveAttribute('href', want);
        });
    }
});
