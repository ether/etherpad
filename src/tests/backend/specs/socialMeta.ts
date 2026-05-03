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
    backup.favicon = settings.favicon;
  });

  afterEach(async function () {
    settings.title = backup.title;
    settings.favicon = backup.favicon;
  });

  describe('pad page', function () {
    it('emits og:title with pad name and site title', async function () {
      const res = await agent.get('/p/TestPad7599').expect(200);
      assert.equal(ogTag(res.text, 'og:title'), `TestPad7599 | ${settings.title}`);
    });

    it('emits og:description from the i18n catalog (English default)', async function () {
      const res = await agent.get('/p/TestPad7599')
          .set('Accept-Language', 'en').expect(200);
      const desc = ogTag(res.text, 'og:description');
      // Sourced from src/locales/en.json under "pad.social.description".
      assert.ok(desc && desc.length > 0, `og:description should be non-empty, got: ${desc}`);
      assert.match(desc!, /collaborative/i);
    });

    it('falls back to English description when language has no override', async function () {
      // Most non-English locales do not yet translate pad.social.description,
      // so a request in (e.g.) Japanese should still receive the English string.
      const res = await agent.get('/p/TestPad7599')
          .set('Accept-Language', 'ja').expect(200);
      const desc = ogTag(res.text, 'og:description');
      assert.ok(desc && desc.length > 0,
          'og:description should fall back to en, not be empty');
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

    it('uses the Express-decoded pad name in og:title', async function () {
      // %2D is "-"; Express decodes the route param before we see it, so
      // og:title contains the decoded form.
      const res = await agent.get('/p/Has%2DDash7599').expect(200);
      const title = ogTag(res.text, 'og:title');
      assert.ok(title && title.startsWith('Has-Dash7599 | '),
          `unexpected og:title: ${title}`);
    });

    it('does not throw for pad names containing literal "%"', async function () {
      // /p/100%25 → Express decodes to req.params.pad === "100%". A naive
      // second decodeURIComponent call would throw URIError; this test
      // guards that regression.
      const res = await agent.get('/p/100%25Test').expect(200);
      assert.ok(ogTag(res.text, 'og:title'), 'og:title should still render');
    });

    it('HTML-escapes pad names to prevent XSS via crafted IDs', async function () {
      const res = await agent.get('/p/' + encodeURIComponent('<script>alert(1)</script>'))
          .expect((r: any) => {
            // Etherpad may 404 or render — either is fine, but no raw <script>
            // injected via og:title.
          });
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
