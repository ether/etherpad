'use strict';

/**
 * Coverage for the `/p/:pad/timeslider` redirect when the request
 * carries a hostile `x-proxy-path` header. The Location header must
 * always be a same-origin path — never protocol-relative, never an
 * absolute URL — regardless of what value the proxy header supplied.
 */

const common = require('../common');

let agent: any;

describe(__filename, function () {
  before(async function () { agent = await common.init(); });

  describe('GET /p/:pad/timeslider with hostile x-proxy-path', function () {
    const padId = 'TimesliderRedirectTest';

    it('rejects a protocol-relative proxy-path (//evil.example)', async function () {
      const res = await agent.get(`/p/${padId}/timeslider`)
          .set('x-proxy-path', '//evil.example')
          .expect(302);
      const loc: string = res.headers.location;
      if (typeof loc !== 'string') {
        throw new Error(`expected a Location header, got ${JSON.stringify(res.headers)}`);
      }
      // The actual security property: the redirect must NOT be parseable
      // as cross-origin. Two shapes of cross-origin would be bad:
      //   - protocol-relative (`//host/...`), which browsers honor as
      //     `<current scheme>://host/...`
      //   - absolute (`https://host/...`)
      // The sanitiser collapses `//+` -> `/` and strips `:`, so the result
      // is always a same-origin path. The attacker's "host" surviving as
      // a path SEGMENT (e.g. `/evil.example/p/x`) is harmless — the
      // browser stays on the etherpad origin and gets a 404.
      if (loc.startsWith('//')) {
        throw new Error(
            `regression: redirect is protocol-relative — Location: ${loc}`);
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(loc)) {
        throw new Error(
            `regression: redirect has a scheme (cross-origin) — Location: ${loc}`);
      }
      // The path component must still include the pad id (the legitimate
      // payload of the redirect).
      if (!loc.includes(`/p/${padId}`)) {
        throw new Error(
            `unexpected redirect target: ${loc} (wanted to include /p/${padId})`);
      }
    });

    it('rejects ///evil with more leading slashes', async function () {
      const res = await agent.get(`/p/${padId}/timeslider`)
          .set('x-proxy-path', '///evil.example/x')
          .expect(302);
      const loc: string = res.headers.location;
      if (loc.startsWith('//')) {
        throw new Error(
            `regression: redirect is protocol-relative — Location: ${loc}`);
      }
    });

    it('honours a well-formed proxy-path (/pad/etherpad)', async function () {
      const res = await agent.get(`/p/${padId}/timeslider`)
          .set('x-proxy-path', '/pad/etherpad')
          .expect(302);
      const loc: string = res.headers.location;
      // Must start with a single slash and contain the legitimate prefix.
      if (!loc.startsWith('/pad/etherpad/p/')) {
        throw new Error(`unexpected redirect target: ${loc}`);
      }
    });

    it('handles a request with no proxy-path header', async function () {
      const res = await agent.get(`/p/${padId}/timeslider`)
          .expect(302);
      const loc: string = res.headers.location;
      if (loc.startsWith('//') || !/\/p\//.test(loc)) {
        throw new Error(`unexpected redirect target: ${loc}`);
      }
    });

    it('strips HTML-bearing payloads from proxy-path before reflecting them',
        async function () {
          // Belt-and-braces — the same sanitiser is used in admin.ts.
          // For the redirect we only need to confirm the Location header is
          // safe (single leading slash, no angle brackets, no quotes).
          const res = await agent.get(`/p/${padId}/timeslider`)
              .set('x-proxy-path', '"><script>alert(1)</script>')
              .expect(302);
          const loc: string = res.headers.location;
          if (/[<>"']/.test(loc)) {
            throw new Error(
                `regression: Location header contains HTML-breaking ` +
                `characters: ${loc}`);
          }
        });
  });
});
