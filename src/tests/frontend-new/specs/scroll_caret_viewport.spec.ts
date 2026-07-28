import {expect, Page, test} from "@playwright/test";
import {randomUUID} from "node:crypto";

// Regression tests for https://github.com/ether/etherpad/issues/8038
//
// `scrollWhenFocusLineIsOutOfViewport.scrollWhenCaretIsInTheLastLineOfViewport`
// is off by default, so this suite turns it on client-side by patching
// clientVars before pad.ts reads it (Scroll caches the settings object in its
// constructor). With the setting on, moving the caret onto the line at the
// bottom edge of the viewport runs caretPosition.getPosition(), which used to
// look at the *top* window's selection — the caret lives in the ace_inner
// iframe, so that selection is always empty and getPosition() returned null,
// crashing in getBottomOfNextBrowserLine ("can't access property bottom").

const LINE_COUNT = 40;

const padLines = (page: Page) => page.frameLocator('iframe[name="ace_outer"]')
    .frameLocator('iframe[name="ace_inner"]')
    .locator('#innerdocbody > div');

const getOuterScrollY = async (page: Page) => await page.evaluate(() => {
  const outerFrame = document.getElementsByName('ace_outer')[0] as HTMLIFrameElement;
  return outerFrame.contentWindow!.pageYOffset;
});

// Typing and the editor's own scroll handling keep moving the viewport for a
// while after the last keystroke; measuring before that settles makes the
// numbers below meaningless (and is flaky under parallel workers).
const waitForStableScroll = async (page: Page) => {
  let previous = NaN;
  for (let i = 0; i < 24; i++) {
    const current = await getOuterScrollY(page);
    if (current === previous) return current;
    previous = current;
    await page.waitForTimeout(250);
  }
  return previous;
};

const preparePad = async (page: Page, percentageBelowViewport: number) => {
  await page.addInitScript(({pct}) => {
    let stored: unknown;
    Object.defineProperty(window, 'clientVars', {
      configurable: true,
      get() { return stored; },
      set(v) {
        if (v != null && typeof v === 'object') {
          const cv = v as {
            padDeletionToken?: string | null,
            scrollWhenFocusLineIsOutOfViewport?: Record<string, unknown>,
          };
          // The one-time deletion-token modal steals focus and eats clicks.
          cv.padDeletionToken = null;
          cv.scrollWhenFocusLineIsOutOfViewport = {
            percentage: {editionAboveViewport: 0, editionBelowViewport: pct},
            duration: 0,
            scrollWhenCaretIsInTheLastLineOfViewport: true,
            percentageToScrollWhenUserPressesArrowUp: 0,
          };
        }
        stored = v;
      },
    });
  }, {pct: percentageBelowViewport});

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`http://localhost:9001/p/SCROLL_CARET_${randomUUID()}`);
  await page.waitForSelector('iframe[name="ace_outer"]');
  await page.waitForSelector('#editorcontainer.initialized');
  const body = page.frameLocator('iframe[name="ace_outer"]')
      .frameLocator('iframe[name="ace_inner"]')
      .locator('#innerdocbody[contenteditable="true"]');
  await body.waitFor({state: 'attached'});
  await body.click();

  // Enough lines that the pad overflows the viewport several times over.
  // insertText rather than keyboard.type: per-key events race Etherpad's
  // input pipeline under Firefox + WITH_PLUGINS load and drop characters.
  const lines = Array.from({length: LINE_COUNT}, (_v, i) => `line ${i}`);
  for (let i = 0; i < lines.length; i++) {
    await page.keyboard.insertText(lines[i]);
    await page.keyboard.press('Enter');
  }
  await waitForStableScroll(page);

  // Typing leaves the caret on the last line with the pad scrolled to its end.
  // Put the caret back near the top; the editor follows the caret, so this is
  // a viewport position that stays put.
  await padLines(page).nth(3).click();
  await waitForStableScroll(page);

  return {errors};
};

// Clicks the line sitting at the very bottom edge of the editor viewport —
// the case #8038 is about. Clicking through a locator would scroll the target
// into view first and move the very edge we are aiming at, so this clicks by
// coordinate instead.
const clickBottomEdgeOfViewport = async (page: Page) => {
  const point = await page.evaluate(() => {
    const outerFrame = document.getElementsByName('ace_outer')[0] as HTMLIFrameElement;
    const outerWin = outerFrame.contentWindow!;
    const outerDoc = outerWin.document;
    const innerFrame = outerDoc.getElementsByName('ace_inner')[0] as HTMLIFrameElement;
    const innerDoc = innerFrame.contentWindow!.document;
    const frameRect = outerFrame.getBoundingClientRect();
    const visibleBottom = outerWin.pageYOffset + outerDoc.documentElement.clientHeight;
    const lines = [...innerDoc.body.children].filter(
        (e) => e.tagName === 'DIV') as HTMLElement[];
    // the line crossing the bottom edge, i.e. the one that is only partly
    // visible: its next line is the first one below the viewport
    const straddling = lines.find((l) =>
      l.offsetTop < visibleBottom && l.offsetTop + l.offsetHeight > visibleBottom);
    const target = straddling || lines[lines.length - 1];
    // a few pixels into the visible sliver of that line
    const y = frameRect.top + (target.offsetTop - outerWin.pageYOffset) + 3;
    return {x: Math.round(frameRect.left + 80), y: Math.round(y)};
  });
  await page.mouse.click(point.x, point.y);
};

test.describe('scroll when caret is in the last line of the viewport', () => {
  // A small, fixed viewport keeps the numbers below predictable: 40 lines
  // overflow it several times over, and the jump this feature adds is large
  // compared to the line-sized steps the browser scrolls on its own.
  test.use({viewport: {width: 900, height: 500}});

  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  test('moving the caret to the bottom of the viewport does not throw',
      async ({page}) => {
        const {errors} = await preparePad(page, 0);
        await clickBottomEdgeOfViewport(page);
        await page.waitForTimeout(500);
        // arrow keys walk the caret across the edge as well
        for (let i = 0; i < 4; i++) {
          await page.keyboard.press('ArrowDown');
          await page.waitForTimeout(200);
        }
        expect(errors).toEqual([]);
      });

  test('scrolls the caret line clear of the bottom edge of the viewport',
      async ({page, browserName}) => {
        // Firefox applies its own scroll-into-view for the clicked line before
        // this check runs, which leaves the "is the next line past the bottom
        // edge?" comparison decided by a pixel or two — too marginal to assert
        // on. The behaviour is the same there; only the trigger is hard to hit
        // reproducibly. The crash regression above still covers both browsers.
        test.skip(browserName === 'firefox',
            'trigger geometry is sub-pixel marginal in Firefox');
        const {errors} = await preparePad(page, 0.6);

        // Whether a given click lands exactly on the line the editor considers
        // to be at the bottom edge comes down to sub-pixel line geometry, so
        // try a few times and look for the one big jump: putting the caret
        // line 60% of a viewport clear of the bottom edge. The browser never
        // scrolls that far on its own — line by line it moves a line height at
        // a time — and it only happens when the caret geometry is read from
        // the editor document.
        let biggestJump = 0;
        for (let attempt = 0; attempt < 4 && biggestJump <= 300; attempt++) {
          const before = await getOuterScrollY(page);
          await clickBottomEdgeOfViewport(page);
          await page.waitForTimeout(750);
          biggestJump = Math.max(biggestJump, await getOuterScrollY(page) - before);
          await waitForStableScroll(page);
        }

        expect(biggestJump).toBeGreaterThan(300);
        expect(errors).toEqual([]);
      });
});
