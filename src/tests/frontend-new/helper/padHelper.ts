import {expect, Frame, Locator, Page} from "@playwright/test";
import {MapArrayType} from "../../../node/types/MapType";
import {randomUUID} from "node:crypto";

export const getPadOuter =  async (page: Page): Promise<Frame> => {
  return page.frame('ace_outer')!;
}

export const getPadBody =  async (page: Page): Promise<Locator> => {
  return page.frame('ace_inner')!.locator('#innerdocbody')
}

export const selectAllText = async (page: Page) => {
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
}

export const toggleUserList = async (page: Page) => {
  await page.locator("button[data-l10n-id='pad.toolbar.showusers.title']").click()
}

export const setUserName = async (page: Page, userName: string) => {
  await page.waitForSelector('[class="popup popup-show"]')
  await page.click("input[data-l10n-id='pad.userlist.entername']");
  await page.keyboard.type(userName);
}


export const showChat = async (page: Page) => {
  const chatIcon = page.locator("#chaticon")
  const classes = await chatIcon.getAttribute('class')
  if (classes && !classes.includes('visible')) return
  await chatIcon.click()
  await page.waitForFunction(`!document.querySelector('#chaticon').classList.contains('visible')`)
}

export const getCurrentChatMessageCount = async (page: Page) => {
  return await page.locator('#chattext').locator('p').count()
}

export const getChatUserName = async (page: Page) => {
  return await page.locator('#chattext')
    .locator('p')
    .locator('b')
    .innerText()
}

export const getChatMessage = async (page: Page) => {
  return (await page.locator('#chattext')
    .locator('p')
    .textContent({}))!
    .split(await getChatTime(page))[1]

}


export const getChatTime = async (page: Page) => {
  return await page.locator('#chattext')
    .locator('p')
    .locator('.time')
    .innerText()
}

export const sendChatMessage = async (page: Page, message: string) => {
  let currentChatCount = await getCurrentChatMessageCount(page)

  const chatInput = page.locator('#chatinput')
  await chatInput.click()
  await page.keyboard.type(message)
  await page.keyboard.press('Enter')
  if(message === "") return
  await page.waitForFunction(`document.querySelector('#chattext').querySelectorAll('p').length >${currentChatCount}`)
}

export const isChatBoxShown = async (page: Page):Promise<boolean> => {
  const classes = await page.locator('#chatbox').getAttribute('class')
  return classes !==null && classes.includes('visible')
}

export const isChatBoxSticky = async (page: Page):Promise<boolean> => {
  const classes = await page.locator('#chatbox').getAttribute('class')
  console.log('Chat', classes && classes.includes('stickyChat'))
  return classes !==null && classes.includes('stickyChat')
}

export const hideChat = async (page: Page) => {
  if(!await isChatBoxShown(page)|| await isChatBoxSticky(page)) return
  await page.locator('#titlecross').click()
  await page.waitForFunction(`!document.querySelector('#chatbox').classList.contains('stickyChat')`)

}

export const enableStickyChatviaIcon = async (page: Page) => {
  if(await isChatBoxSticky(page)) return
  await page.locator('#titlesticky').click()
  await page.waitForFunction(`document.querySelector('#chatbox').classList.contains('stickyChat')`)
}

export const disableStickyChatviaIcon = async (page: Page) => {
  if(!await isChatBoxSticky(page)) return
  await page.locator('#titlecross').click()
  await page.waitForFunction(`!document.querySelector('#chatbox').classList.contains('stickyChat')`)
}


export const appendQueryParams = async (page: Page, queryParameters: MapArrayType<string>) => {
  const searchParams = new URLSearchParams(page.url().split('?')[1]);
  Object.keys(queryParameters).forEach((key) => {
    searchParams.append(key, queryParameters[key]);
  });
  await page.goto(page.url()+"?"+ searchParams.toString());
  await page.waitForSelector('iframe[name="ace_outer"]');
  await page.waitForSelector('#editorcontainer.initialized');
}

// Wait until the inner editor body has flipped from
// `class="static" contentEditable="false"` to editable. ace does this
// once padeditor.init resolves; under WITH_PLUGINS load in Firefox the
// flip can lag past `#editorcontainer.initialized`, long enough that
// an immediate click + keyboard.type runs against a still-static body
// and is silently dropped (the body keeps showing the default welcome
// text and never sees the input). Helpers used by every test call
// this so we only have one source of truth for "the editor is ready
// to receive input".
const waitForEditorReady = async (page: Page) => {
  await page.waitForSelector('iframe[name="ace_outer"]');
  await page.waitForSelector('#editorcontainer.initialized');
  await page.frameLocator('iframe[name="ace_outer"]')
            .frameLocator('iframe[name="ace_inner"]')
            .locator('#innerdocbody[contenteditable="true"]')
            .waitFor({state: 'attached'});
};

export const goToNewPad = async (page: Page) => {
  // create a new pad before each test run
  const padId = "FRONTEND_TESTS"+randomUUID();
  await page.goto('http://localhost:9001/p/'+padId);
  await waitForEditorReady(page);
  return padId;
}

export const goToPad = async (page: Page, padId: string) => {
  await page.goto('http://localhost:9001/p/'+padId);
  await waitForEditorReady(page);
}


export const clearPadContent = async (page: Page) => {
  const body = await getPadBody(page);
  await body.click();
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Delete');
}

export const writeToPad = async (page: Page, text: string) => {
  const body = await getPadBody(page);
  await body.click();
  // Use insertText (single input event) instead of keyboard.type
  // (one keydown/keyup per char). Firefox under WITH_PLUGINS load
  // racily drops characters from per-key events; insertText delivers
  // each chunk in one event, which Etherpad's incorporateUserChanges
  // pipeline handles atomically. insertText does not translate \n
  // into a real Enter keystroke, so split on newlines and press
  // Enter between segments to preserve multi-line input.
  //
  // For long multi-line writes (e.g. timeslider_follow's ~100-line
  // setup) a tight keyboard.press('Enter') sequence still races the
  // editor's input pipeline under load and drops occasional Enters,
  // leaving the pad short by a line. Value-wait for the line count
  // to advance after each Enter so the next press only fires once
  // the previous has landed.
  const lines = text.split('\n');
  const baseLineCount = await body.locator('div').count();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.insertText(lines[i]);
    if (i < lines.length - 1) {
      // Press Enter; if the editor doesn't acknowledge the new line
      // within a short window, the keystroke was dropped — re-press.
      // Up to 3 attempts per Enter; under WITH_PLUGINS load Firefox
      // occasionally swallows an Enter even after insertText has
      // landed.
      const expectedCount = baseLineCount + i + 1;
      let attempt = 0;
      while (attempt < 3) {
        await page.keyboard.press('Enter');
        try {
          await expect(body.locator('div'))
              .toHaveCount(expectedCount, {timeout: 2000});
          break;
        } catch {
          attempt++;
          if (attempt === 3) {
            // Last try: surface the original timeout with the full
            // 20s budget so the failure mode is the canonical
            // "expected N, got M" rather than a swallowed retry loop.
            await expect(body.locator('div')).toHaveCount(expectedCount);
          }
        }
      }
    }
  }
}

export const clearAuthorship = async (page: Page) => {
  // Use force:true to bypass the toolbar-overlay div that can intercept clicks
  // after text selection. The overlay is cosmetic and doesn't affect the button action.
  await page.locator("button[data-l10n-id='pad.toolbar.clearAuthorship.title']").click({force: true})
}

export const undoChanges = async (page: Page) => {
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
}

export const pressUndoButton = async (page: Page) => {
  await page.locator('.buttonicon-undo').click()
}
