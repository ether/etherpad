import {expect, test} from '@playwright/test';

// The OIDC login page builds its POST target from the `state` query
// parameter. A state that is not an interaction uid must not be sent.
const etherpad = 'http://localhost:9001';

test.describe('OIDC login page state parameter', () => {
  // /views/login.html only exists after `pnpm --filter ui run build-copy`.
  // Plugin CI runs these specs against core without that step, so skip
  // there. Core's frontend workflow sets CI_REQUIRE_OIDC_UI so a missing
  // build fails instead of skipping silently.
  test.beforeAll(async () => {
    const res = await fetch(`${etherpad}/views/login.html`);
    await res.body?.cancel();
    // Only a missing build is skippable; any other error is a real failure.
    if (res.status !== 404) {
      expect(res.status, '/views/login.html status').toBe(200);
      return;
    }
    const reason = '/views/login.html returned 404; ' +
        'run `pnpm --filter ui run build-copy` to build the OIDC UI';
    if (process.env.CI_REQUIRE_OIDC_UI) throw new Error(reason);
    test.skip(true, reason);
  });

  for (const state of ['../../p/other', '..%2F..%2Fp%2Fother', 'a/b']) {
    test(`does not POST anywhere for state=${state}`, async ({page}) => {
      const posts: string[] = [];
      page.on('request', (r) => { if (r.method() === 'POST') posts.push(r.url()); });
      await page.goto(`${etherpad}/views/login.html?client_id=test&state=${encodeURIComponent(state)}`);
      await page.fill('input[name=login]', 'someone');
      await page.fill('input[name=password]', 'secret');
      await page.click('input[type=submit]');
      await expect(page.locator('#error')).toHaveText('Error signing in');
      expect(posts).toEqual([]);
    });
  }

  test('posts to /interaction/<uid> for a well-formed state', async ({page}) => {
    const uid = 'V1StGXR8_Z5jdHi6B-myT';
    // Stub the provider so the test does not depend on a live interaction.
    await page.route('**/interaction/**', (route) => route.fulfill({status: 400, body: '{}'}));
    await page.goto(`${etherpad}/views/login.html?client_id=test&state=${uid}`);
    await page.fill('input[name=login]', 'someone');
    await page.fill('input[name=password]', 'secret');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST'),
      page.click('input[type=submit]'),
    ]);
    expect(new URL(req.url()).pathname).toBe(`/interaction/${uid}`);
  });
});
