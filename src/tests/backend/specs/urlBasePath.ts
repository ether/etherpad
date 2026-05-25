/**
 * End-to-end coverage for X-Forwarded-Prefix / X-Ingress-Path support (#7802).
 *
 * Verifies that across the public surfaces:
 *   - /
 *   - /p/:pad
 *   - /manifest.json
 *
 * a single sanitised proxy-path is reflected consistently in the
 * rendered HTML and JSON: <link rel="manifest">, og:url, og:image,
 * manifest start_url, manifest icon srcs, reconnect form action.
 *
 * Also verifies the no-header case still produces today's output
 * (regression guard).
 */

import * as common from '../common.js';
import settings from '../../../node/utils/Settings.js';

let agent: any;

const expectHas = (haystack: string, needle: string, label: string) => {
  if (!haystack.includes(needle)) {
    throw new Error(`expected ${label} to include ${JSON.stringify(needle)}.\n--- got ---\n${haystack.slice(0, 800)}\n...`);
  }
};

const expectMisses = (haystack: string, needle: string, label: string) => {
  if (haystack.includes(needle)) {
    throw new Error(`${label} should not include ${JSON.stringify(needle)}.\n--- got ---\n${haystack.slice(0, 800)}\n...`);
  }
};

describe(__filename, function () {
  before(async function () { agent = await common.init(); });

  describe('no proxy headers - backwards compatibility', function () {
    it('/ renders today\'s URLs', async function () {
      const res = await agent.get('/').expect(200);
      expectHas(res.text, 'href="/manifest.json"', 'index manifest link');
    });

    it('/p/:pad renders today\'s URLs', async function () {
      const res = await agent.get('/p/UrlBasePathTest').expect(200);
      expectHas(res.text, 'action="/ep/pad/reconnect"', 'reconnect form action');
      expectHas(res.text, 'href="../manifest.json"', 'manifest link (relative form)');
    });

    it('/manifest.json returns root-relative paths', async function () {
      const res = await agent.get('/manifest.json').expect(200);
      if (res.body.start_url !== '/') {
        throw new Error(`expected "/", got ${res.body.start_url}`);
      }
    });
  });

  describe('with x-proxy-path: /sub', function () {
    const headers = {'x-proxy-path': '/sub'};

    it('/ has /sub-prefixed manifest link', async function () {
      const res = await agent.get('/').set(headers).expect(200);
      expectHas(res.text, 'href="/sub/manifest.json"', 'index manifest link');
      expectMisses(res.text, 'href="/manifest.json"', 'unprefixed manifest link');
    });

    it('/p/:pad reconnect form action carries the prefix', async function () {
      const res = await agent.get('/p/UrlBasePathTest').set(headers).expect(200);
      expectHas(res.text, 'action="/sub/ep/pad/reconnect"', 'reconnect form action');
      // The manifest <link> stays relative (../manifest.json); browser resolves
      // it to /sub/manifest.json based on the request URL - we assert the
      // template emits the relative form unchanged.
      expectHas(res.text, 'href="../manifest.json"', 'manifest link (relative form)');
    });

    it('/p/:pad og:url and og:image carry the prefix', async function () {
      const res = await agent.get('/p/UrlBasePathTest').set(headers).expect(200);
      expectHas(res.text, '/sub/p/UrlBasePathTest', 'og:url path');
      expectHas(res.text, '/sub/favicon.ico', 'og:image path');
    });

    it('/manifest.json has /sub-prefixed start_url and icon srcs', async function () {
      const res = await agent.get('/manifest.json').set(headers).expect(200);
      if (res.body.start_url !== '/sub/') {
        throw new Error(`expected /sub/, got ${res.body.start_url}`);
      }
      for (const icon of res.body.icons) {
        if (!icon.src.startsWith('/sub/')) {
          throw new Error(`icon src missing prefix: ${icon.src}`);
        }
      }
    });
  });

  describe('with x-ingress-path under trustProxy', function () {
    const headers = {'x-ingress-path': '/api/hassio_ingress/abc'};
    let originalTrust: boolean;

    before(function () {
      originalTrust = settings.trustProxy;
      settings.trustProxy = true;
    });
    after(function () { settings.trustProxy = originalTrust; });

    it('/p/:pad picks up the HA ingress prefix in the reconnect form action', async function () {
      const res = await agent.get('/p/UrlBasePathTest').set(headers).expect(200);
      expectHas(res.text, 'action="/api/hassio_ingress/abc/ep/pad/reconnect"', 'reconnect form action');
    });

    it('/manifest.json picks up the HA ingress prefix', async function () {
      const res = await agent.get('/manifest.json').set(headers).expect(200);
      if (res.body.start_url !== '/api/hassio_ingress/abc/') {
        throw new Error(`expected /api/hassio_ingress/abc/, got ${res.body.start_url}`);
      }
    });
  });

  describe('with x-ingress-path WITHOUT trustProxy', function () {
    const headers = {'x-ingress-path': '/api/hassio_ingress/abc'};

    it('header is ignored - output is today\'s', async function () {
      // setUp guarantees trustProxy starts at its default (false) - see common.init
      const res = await agent.get('/p/UrlBasePathTest').set(headers).expect(200);
      expectHas(res.text, 'action="/ep/pad/reconnect"', 'unprefixed reconnect form action');
      expectMisses(res.text, '/api/hassio_ingress/', 'leaked ingress prefix');
    });
  });
});
