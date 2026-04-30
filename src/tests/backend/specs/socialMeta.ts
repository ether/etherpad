'use strict';

import {MapArrayType} from "../../../node/types/MapType";

const assert = require('assert').strict;
const common = require('../common');
import settings from '../../../node/utils/Settings';

const ogTag = (html: string, prop: string): string | null => {
  const re = new RegExp(
      `<meta\\s+(?:property|name)="${prop.replace(/[.*+?^${}()|[\\]/g, '\\$&')}"\\s+content="([^"]*)">`);
  const m = html.match(re);
  return m ? m[1] : null;
};

describe(__filename, function () {
  let agent: any;
  const backup: MapArrayType<any> = {};

  before(async function () {
    agent = await common.init();
  });

  beforeEach(async function () {
    backup.title = settings.title;
    backup.socialDescription = settings.socialDescription;
    backup.favicon = settings.favicon;
  });

  afterEach(async function () {
    settings.title = backup.title;
    settings.socialDescription = backup.socialDescription;
    settings.favicon = backup.favicon;
  });

  describe('pad page', function () {
    it('emits og:title with pad name and site title', async function () {
      const res = await agent.get('/p/TestPad7599').expect(200);
      assert.equal(ogTag(res.text, 'og:title'), `TestPad7599 | ${settings.title}`);
    });

    it('emits the default socialDescription when settings is a plain string', async function () {
      settings.socialDescription = 'Plain string default';
      const res = await agent.get('/p/TestPad7599').expect(200);
      assert.equal(ogTag(res.text, 'og:description'), 'Plain string default');
    });

    it('respects per-locale socialDescription map', async function () {
      settings.socialDescription = {
        default: 'Fallback',
        de: 'Deutsche Beschreibung',
      };
      const res = await agent.get('/p/TestPad7599')
          .set('Accept-Language', 'de').expect(200);
      assert.equal(ogTag(res.text, 'og:description'), 'Deutsche Beschreibung');
    });

    it('falls back to default for unknown locale', async function () {
      settings.socialDescription = {default: 'Fallback', de: 'X'};
      const res = await agent.get('/p/TestPad7599')
          .set('Accept-Language', 'ja').expect(200);
      assert.equal(ogTag(res.text, 'og:description'), 'Fallback');
    });

    it('emits og:image and og:image:alt', async function () {
      const res = await agent.get('/p/TestPad7599').expect(200);
      const img = ogTag(res.text, 'og:image');
      assert.match(img || '', /\/favicon\.ico$/);
      assert.equal(ogTag(res.text, 'og:image:alt'), `${settings.title} logo`);
    });

    it('emits og:locale', async function () {
      const res = await agent.get('/p/TestPad7599')
          .set('Accept-Language', 'en').expect(200);
      const locale = ogTag(res.text, 'og:locale');
      assert.match(locale || '', /^en/);
    });

    it('decodes URL-encoded pad names in og:title', async function () {
      const res = await agent.get('/p/Has%20Space7599').expect(200);
      const title = ogTag(res.text, 'og:title');
      assert.ok(title && title.startsWith('Has Space7599 | '),
          `unexpected og:title: ${title}`);
    });

    it('HTML-escapes pad names to prevent XSS via crafted IDs', async function () {
      const res = await agent.get('/p/' + encodeURIComponent('<script>alert(1)</script>'))
          .expect((r: any) => {
            // Etherpad may 404 or render — either is fine, but no raw <script>
            // injected via og:title.
          });
      // Whatever the status code, the response body must not contain a raw
      // <script> from our meta tags.
      const ogTitle = ogTag(res.text || '', 'og:title');
      if (ogTitle != null) {
        assert.ok(!/<script>/i.test(ogTitle),
            `og:title leaked raw HTML: ${ogTitle}`);
      }
    });

    it('emits twitter:card summary', async function () {
      const res = await agent.get('/p/TestPad7599').expect(200);
      assert.equal(ogTag(res.text, 'twitter:card'), 'summary');
    });
  });

  describe('timeslider', function () {
    it('og:title contains the (history) marker', async function () {
      const res = await agent.get('/p/TestPad7599/timeslider').expect(200);
      const title = ogTag(res.text, 'og:title');
      assert.ok(title && title.includes('(history)'),
          `unexpected timeslider og:title: ${title}`);
    });
  });

  describe('homepage', function () {
    it('og:title equals settings.title', async function () {
      const res = await agent.get('/').expect(200);
      assert.equal(ogTag(res.text, 'og:title'), settings.title);
    });
  });
});
