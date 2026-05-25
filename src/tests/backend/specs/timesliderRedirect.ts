// Issue #7659 — direct visits to /p/:pad/timeslider should now 302-redirect
// to the pad page; the pad's PadModeController handles entering history mode
// from the URL hash. Iframe consumers pass ?embed=1 and still receive the
// timeslider HTML for embedded use.

import * as assert from 'node:assert/strict';
import * as common from '../common.js';

describe(__filename, function () {
  let agent: any;

  before(async function () {
    agent = await common.init();
  });

  describe('/p/:pad/timeslider', function () {
    it('redirects (302) direct visits to the pad page', async function () {
      const res = await agent.get('/p/testRedirect-7659/timeslider').expect(302);
      assert.match(res.headers.location, /testRedirect-7659/);
      // Must not point back at /timeslider — that would loop.
      assert.doesNotMatch(res.headers.location, /\/timeslider(\?|$)/);
    });

    it('preserves the pad name in the redirect target', async function () {
      // Etherpad normalizes spaces to underscores in pad names; the
      // redirect target should match whatever the route handler resolved
      // req.params.pad to, percent-escaped where needed.
      const padName = 'Pad-With-Hyphens-7659';
      const res = await agent
          .get(`/p/${encodeURIComponent(padName)}/timeslider`)
          .expect(302);
      assert.match(res.headers.location, /Pad-With-Hyphens-7659/);
    });

    it('serves the timeslider HTML when embed=1 (iframe path)', async function () {
      const res = await agent
          .get('/p/testEmbed-7659/timeslider?embed=1')
          .expect(200);
      assert.match(res.headers['content-type'], /text\/html/);
      assert.match(res.text, /class="[^"]*embedded-history-frame/);
    });
  });
});
