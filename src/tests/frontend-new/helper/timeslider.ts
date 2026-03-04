import {Page} from "@playwright/test";

/**
 * Sets the src-attribute of the main iframe to the timeslider
 * In case a revision is given, sets the timeslider to this specific revision.
 * Defaults to going to the last revision.
 * It waits until the timer is filled with date and time, because it's one of the
 * last things that happen during timeslider load
 *
 * @param page
 * @param {number} [revision] the optional revision
 * @returns {Promise}
 * @todo for some reason this does only work the first time, you cannot
 * goto rev 0 and then via the same method to rev 5. Use buttons instead
 */
export const gotoTimeslider = async (page: Page, revision: number): Promise<any> => {
    let revisionString = Number.isInteger(revision) ? `#${revision}` : '';
    await page.goto(`${page.url()}/timeslider${revisionString}`);
    await page.waitForSelector('#timer')
};
