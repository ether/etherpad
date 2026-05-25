'use strict';

/**
 * Coverage for /manifest.json prefix-awareness.
 *
 * Without a proxy header the manifest should emit today's values
 * (leading-slash absolute paths). With a sanitised `x-proxy-path`,
 * `x-forwarded-prefix` (requires trustProxy) or `x-ingress-path`
 * (requires trustProxy), the manifest should emit prefixed paths so
 * the PWA renders icons and start_url correctly when Etherpad is
 * proxied under a subpath.
 */

const common = require('../common');
import settings from '../../../node/utils/Settings.js';

let agent: any;

describe(__filename, function () {
  before(async function () { agent = await common.init(); });

  describe('/manifest.json without proxy headers', function () {
    it('emits leading-slash icon srcs and start_url=/', async function () {
      const res = await agent.get('/manifest.json').expect(200);
      const m = res.body;
      if (m.start_url !== '/') {
        throw new Error(`expected start_url "/", got ${JSON.stringify(m.start_url)}`);
      }
      const srcs = (m.icons || []).map((i: any) => i.src);
      for (const s of srcs) {
        if (!s.startsWith('/')) {
          throw new Error(`expected leading-slash icon src, got ${s}`);
        }
      }
    });
  });

  describe('/manifest.json with x-proxy-path', function () {
    it('prefixes every icon src and start_url', async function () {
      const res = await agent.get('/manifest.json')
          .set('x-proxy-path', '/sub')
          .expect(200);
      const m = res.body;
      if (m.start_url !== '/sub/') {
        throw new Error(`expected start_url "/sub/", got ${JSON.stringify(m.start_url)}`);
      }
      const srcs = (m.icons || []).map((i: any) => i.src);
      for (const s of srcs) {
        if (!s.startsWith('/sub/')) {
          throw new Error(`expected /sub/-prefixed icon src, got ${s}`);
        }
      }
    });

    it('sets Vary so caches don\'t collapse responses across prefixes', async function () {
      const res = await agent.get('/manifest.json')
          .set('x-proxy-path', '/sub')
          .expect(200);
      const vary = (res.headers.vary || '').toLowerCase();
      if (!vary.includes('x-proxy-path')) {
        throw new Error(`expected Vary to include x-proxy-path, got ${vary}`);
      }
    });
  });

  describe('/manifest.json with x-ingress-path (HA)', function () {
    it('ignores the header when trustProxy is off', async function () {
      const original = settings.trustProxy;
      settings.trustProxy = false;
      try {
        const res = await agent.get('/manifest.json')
            .set('x-ingress-path', '/api/hassio_ingress/abc')
            .expect(200);
        if (res.body.start_url !== '/') {
          throw new Error(`expected start_url "/" when trustProxy=false, got ${res.body.start_url}`);
        }
      } finally {
        settings.trustProxy = original;
      }
    });

    it('honors the header when trustProxy is on', async function () {
      const original = settings.trustProxy;
      settings.trustProxy = true;
      try {
        const res = await agent.get('/manifest.json')
            .set('x-ingress-path', '/api/hassio_ingress/abc')
            .expect(200);
        if (res.body.start_url !== '/api/hassio_ingress/abc/') {
          throw new Error(`expected prefixed start_url, got ${res.body.start_url}`);
        }
      } finally {
        settings.trustProxy = original;
      }
    });
  });
});
