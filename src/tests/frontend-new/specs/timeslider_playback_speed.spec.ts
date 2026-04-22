import {expect, Page, test} from "@playwright/test";
import {clearPadContent, goToNewPad, writeToPad} from "../helper/padHelper";

test.describe('timeslider playback speed', function () {
  test.describe.configure({mode: 'serial'});

  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  const waitForTimesliderReady = async (page: Page) => {
    await page.waitForSelector('#timeslider-wrapper', {state: 'visible'});
    await page.waitForFunction(() => {
      return Boolean(document.querySelector('#playpause_button_icon')?.getAttribute('title'));
    });
  };

  test('defaults to original speed with no cookies', async function ({page}) {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'One');
    await page.waitForTimeout(1000);

    await page.goto(`http://localhost:9001/p/${padId}/timeslider#0`);
    await waitForTimesliderReady(page);

    await expect.poll(async () => await page.evaluate(() => {
      const select = document.querySelector('#playbackspeed') as HTMLSelectElement | null;
      return {
        value: select?.value,
        firstOptionText: select?.options[0]?.text,
        selectedText: select?.options[select.selectedIndex]?.text,
      };
    })).toEqual({
      value: '100',
      firstOptionText: 'Original speed',
      selectedText: 'Original speed',
    });
  });

  test('persists the selected playback speed', async function ({page}) {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'One');
    await page.waitForTimeout(300);
    await writeToPad(page, ' Two');
    await page.waitForTimeout(1000);

    await page.goto(`http://localhost:9001/p/${padId}/timeslider#1`);
    await waitForTimesliderReady(page);

    await page.evaluate(() => {
      const select = document.querySelector('#playbackspeed') as HTMLSelectElement;
      select.value = '500';
      select.dispatchEvent(new Event('change', {bubbles: true}));
    });

    await expect.poll(async () => await page.evaluate(() => {
      const select = document.querySelector('#playbackspeed') as HTMLSelectElement | null;
      return {
        controlValue: select?.value,
      };
    })).toEqual({controlValue: '500'});

    await page.reload();
    await waitForTimesliderReady(page);

    await expect.poll(async () => await page.evaluate(() => {
      const select = document.querySelector('#playbackspeed') as HTMLSelectElement | null;
      return {
        controlValue: select?.value,
      };
    })).toEqual({controlValue: '500'});
  });

  test('uses revision timestamps for realtime playback', async function ({page}) {
    const padId = await goToNewPad(page);
    await clearPadContent(page);
    await writeToPad(page, 'A');
    await page.waitForTimeout(1000);

    await page.goto(`http://localhost:9001/p/${padId}/timeslider#0`);
    await waitForTimesliderReady(page);

    const scheduledDelays = await page.evaluate(() => {
      (window as any).revisionInfo.getPath = () => ({
        status: 'complete',
        times: [1234],
      });
      const select = document.querySelector('#playbackspeed') as HTMLSelectElement;
      select.value = 'realtime';
      select.dispatchEvent(new Event('change', {bubbles: true}));
      (window as any).__playbackTimeouts = [];
      window.setTimeout = ((fn: TimerHandler, delay?: number, ...args: any[]) => {
        (window as any).__playbackTimeouts.push({
          delay,
          name: typeof fn === 'function' ? fn.name : String(fn),
        });
        return 1 as any;
      }) as typeof window.setTimeout;
      (document.querySelector('#playpause_button_icon') as HTMLButtonElement).click();
      return (window as any).__playbackTimeouts;
    });

    const scheduledDelay = scheduledDelays[0]?.delay;
    expect(scheduledDelay).toBe(1234);
  });
});
