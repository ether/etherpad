import {expect, test} from "@playwright/test";
import {
    clearAuthorship,
    clearPadContent,
    getPadBody,
    goToNewPad, pressUndoButton,
    selectAllText,
    undoChanges,
    writeToPad
} from "../helper/padHelper";

test.beforeEach(async ({ page })=>{
    // create a new pad before each test run
    await goToNewPad(page);
})

test('clear authorship color', async ({page}) => {
    // get the inner iframe
    const innerFrame =  await getPadBody(page);
    const padText = "Hello"

    // type some text
    await clearPadContent(page);
    await writeToPad(page, padText);
    const retrievedClasses = await innerFrame.locator('div span').nth(0).getAttribute('class')
    expect(retrievedClasses).toContain('author');

    // select the text
    await innerFrame.click()
    await selectAllText(page);

    await clearAuthorship(page);
    // does the first div include an author class?
    const firstDivClass = await innerFrame.locator('div').nth(0).getAttribute('class');
    expect(firstDivClass).not.toContain('author');
    const classes = page.locator('div.disconnected')
    expect(await classes.isVisible()).toBe(false)
})


test("makes text clear authorship colors and checks it can't be undone", async function ({page}) {
    const innnerPad = await getPadBody(page);
    const padText = "Hello"

    // type some text
    await clearPadContent(page);
    await writeToPad(page, padText);

    // get the first text element out of the inner iframe
    const firstDivClass = innnerPad.locator('div').nth(0)
    const retrievedClasses = await innnerPad.locator('div span').nth(0).getAttribute('class')
    expect(retrievedClasses).toContain('author');


    await firstDivClass.focus()
    await clearAuthorship(page);
    expect(await firstDivClass.getAttribute('class')).not.toContain('author');

    await undoChanges(page);
    const changedFirstDiv = innnerPad.locator('div').nth(0)
    expect(await changedFirstDiv.getAttribute('class')).not.toContain('author');


    await pressUndoButton(page);
    const secondChangedFirstDiv = innnerPad.locator('div').nth(0)
    expect(await secondChangedFirstDiv.getAttribute('class')).not.toContain('author');
});


// Test for https://github.com/ether/etherpad-lite/issues/5128
test('clears authorship when first line has line attributes', async function ({page}) {
    // Make sure there is text with author info. The first line must have a line attribute.
    const padBody = await getPadBody(page);
    await padBody.click()
    await clearPadContent(page);
    await writeToPad(page,'Hello')
    await page.locator('.buttonicon-insertunorderedlist').click();
    const retrievedClasses = await padBody.locator('div span').nth(0).getAttribute('class')
    expect(retrievedClasses).toContain('author');
    await padBody.click()
    await selectAllText(page);
    await clearAuthorship(page);
    const retrievedClasses2 = await padBody.locator('div span').nth(0).getAttribute('class')
    expect(retrievedClasses2).not.toContain('author');

    expect(await page.locator('[class*="author-"]').count()).toBe(0)
});
