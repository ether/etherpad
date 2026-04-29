import {expect, test} from '@playwright/test';
import {clearPadContent, goToNewPad, writeToPad} from '../helper/padHelper';

test.describe('unaccepted commit warning', () => {
  test('hasUnacceptedCommit clears once the server acknowledges the commit',
      async ({page}) => {
        await goToNewPad(page);
        await clearPadContent(page);
        await writeToPad(page, 'trigger a commit');

        // Wait for the commit to round-trip. The fix clears the pending marker inside
        // acceptCommit(); without it the boolean stays true indefinitely.
        await expect.poll(async () => await page.evaluate(() =>
          (window as any).pad?.collabClient?.hasUnacceptedCommit?.() ?? null,
        ), {timeout: 10000}).toBe(false);
      });

  test('disconnect with a pending commit surfaces the unsaved-edit gritter',
      async ({page}) => {
        await goToNewPad(page);
        await page.waitForFunction(() => (window as any).pad?.collabClient != null);

        await page.evaluate(() => {
          const p: any = (window as any).pad;
          // Force the pending-commit predicate to true and simulate a disconnect so
          // the warning code path executes deterministically.
          p.collabClient.hasUnacceptedCommit = () => true;
          p.handleChannelStateChange('DISCONNECTED', {
            type: 'disconnect',
            explanation: 'test',
            cause: 'test',
            forIE: false,
            canRetry: false,
          });
        });

        await expect(page.locator('.unsaved-warning').first()).toBeVisible();
      });
});
