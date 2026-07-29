'use strict';

/**
 * Regression coverage for GHSA-mc8w-wjhw-45x5 — a pre-auth path-traversal /
 * arbitrary-file-read in the /static/* handler (src/node/utils/Minify.ts).
 *
 * On POSIX systems a backslash is an ordinary filename byte, so
 * sanitizePathname() deliberately leaves a segment such as `..\..\..` untouched
 * (it contains no `.`/`..` *path components*). Minify.ts used to convert `\` to
 * `/` unconditionally *after* the sanitiser had run, turning those bytes back
 * into `../` traversal components with no re-check, e.g.
 *
 *   GET /static/plugins/ep_etherpad-lite/static/..%5C..%5C..%5C..%5Cetc/passwd
 *
 * would return /etc/passwd to any unauthenticated client. The route is mounted
 * on expressPreSession, before the auth middleware, so no credentials were
 * required. See the advisory for the full RCE escalation.
 *
 * The fix guards that conversion to Windows only. These tests assert the
 * encoded-backslash traversal no longer escapes the plugin's static root, while
 * ordinary static assets are still served.
 */

const common = require('../common');

let agent: any;

// %5C is an encoded backslash — the only separator that survived the sanitiser
// on POSIX. %2F would decode to `/`, be re-split, and get rejected by the
// existing `..` guard, so the exploit relied on %5C specifically.
const BS = '%5C';

describe(__filename, function () {
  before(async function () { agent = await common.init(); });

  describe('pre-auth arbitrary file read via /static/* (GHSA-mc8w-wjhw-45x5)', function () {
    // Over-shoot the traversal depth; surplus `..` is absorbed at `/`, so this
    // is root-depth agnostic and would resolve to /etc/passwd if vulnerable.
    const climb = `..${BS}`.repeat(10);

    it('does not disclose /etc/passwd through the ep_etherpad-lite static route', async function () {
      const res = await agent.get(`/static/plugins/ep_etherpad-lite/static/${climb}etc/passwd`);
      if (res.status === 200 && /root:.*:0:0:/.test(res.text || '')) {
        throw new Error(
            'regression: /static/* leaked /etc/passwd (GHSA-mc8w-wjhw-45x5) — ' +
            `status ${res.status}`);
      }
      // The traversal segment is now a literal (non-existent) filename → 404.
      if (res.status !== 404) {
        throw new Error(`expected 404 for traversal payload, got ${res.status}`);
      }
    });

    it('does not disclose settings via /proc/self/cwd', async function () {
      const res =
          await agent.get(`/static/plugins/ep_etherpad-lite/static/${climb}proc/self/cwd/settings.json`);
      if (res.status === 200 && /(sessionKey|dbSettings|"admin")/.test(res.text || '')) {
        throw new Error(
            'regression: /static/* leaked settings.json via /proc/self/cwd ' +
            '(GHSA-mc8w-wjhw-45x5)');
      }
      if (res.status !== 404) {
        throw new Error(`expected 404 for /proc/self/cwd payload, got ${res.status}`);
      }
    });

    it('still serves a legitimate plugin static asset', async function () {
      // Sanity check that the fix did not break normal static file serving.
      const res = await agent.get('/static/plugins/ep_etherpad-lite/static/skins/no-skin/pad.js');
      if (res.status !== 200) {
        throw new Error(`legitimate static asset should be served, got ${res.status}`);
      }
    });
  });
});
