'use strict';

// Unit tests for the pure helpers in src/node/utils/socialMeta.ts. These
// don't touch HTTP/DB — they exercise the helper directly so every branch
// (locale negotiation, fallbacks, escaping, URL building) is covered without
// the cost of an integration test.

const assert = require('assert').strict;
import {buildSocialMetaHtml, renderSocialMeta} from '../../../node/utils/socialMeta';

const ogTag = (html: string, prop: string): string | null => {
  const re = new RegExp(
      `<meta\\s+(?:property|name)="${prop.replace(/[.*+?^${}()|[\\]/g, '\\$&')}"\\s+content="([^"]*)">`);
  const m = html.match(re);
  return m ? m[1] : null;
};

const fakeReq = (overrides: any = {}) => ({
  protocol: 'https',
  get: (h: string) => h === 'host' ? 'pad.example' : '',
  acceptsLanguages: (langs: string[]) => 'en',
  originalUrl: '/p/Foo',
  params: {pad: 'Foo'},
  ...overrides,
});

const baseSettings = {title: 'Etherpad', favicon: null};
const enLocales = {en: {'pad.social.description': 'English desc'}};

describe(__filename, function () {
  describe('buildSocialMetaHtml', function () {
    it('emits all 13 OG + Twitter Card tags', function () {
      const html = buildSocialMetaHtml({
        url: 'https://x/p/Foo',
        siteName: 'Etherpad',
        title: 'Foo | Etherpad',
        description: 'd',
        imageUrl: 'https://x/favicon.ico',
        imageAlt: 'Etherpad logo',
        renderLang: 'en',
      });
      const expected = [
        ['property', 'og:type'], ['property', 'og:site_name'], ['property', 'og:title'],
        ['property', 'og:description'], ['property', 'og:url'], ['property', 'og:image'],
        ['property', 'og:image:alt'], ['property', 'og:locale'],
        ['name', 'twitter:card'], ['name', 'twitter:title'], ['name', 'twitter:description'],
        ['name', 'twitter:image'], ['name', 'twitter:image:alt'],
      ];
      for (const [, prop] of expected) {
        assert.ok(ogTag(html, prop) != null, `missing tag: ${prop}`);
      }
    });

    it('HTML-escapes every interpolated value', function () {
      const evil = '"><script>alert(1)</script>';
      const html = buildSocialMetaHtml({
        url: evil, siteName: evil, title: evil, description: evil,
        imageUrl: evil, imageAlt: evil, renderLang: 'en',
      });
      assert.ok(!/<script>/i.test(html), 'no raw <script> in output');
      assert.ok(!/"><script/.test(html), 'no attribute breakout');
      assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),
          'tags HTML-encoded');
    });

    it('emits og:locale as xx_XX for region tags', function () {
      const html = buildSocialMetaHtml({
        url: '/', siteName: 'E', title: 'T', description: 'd',
        imageUrl: '/f', imageAlt: 'a', renderLang: 'pt-BR',
      });
      assert.equal(ogTag(html, 'og:locale'), 'pt_BR');
    });

    it('emits og:locale as just primary for bare lang tags', function () {
      const html = buildSocialMetaHtml({
        url: '/', siteName: 'E', title: 'T', description: 'd',
        imageUrl: '/f', imageAlt: 'a', renderLang: 'fr',
      });
      assert.equal(ogTag(html, 'og:locale'), 'fr');
    });

    it('twitter:card is always summary', function () {
      const html = buildSocialMetaHtml({
        url: '/', siteName: 'E', title: 'T', description: 'd',
        imageUrl: '/f', imageAlt: 'a', renderLang: 'en',
      });
      assert.equal(ogTag(html, 'twitter:card'), 'summary');
    });
  });

  describe('renderSocialMeta — title composition', function () {
    it('pad: "{padName} | {siteName}"', function () {
      const html = renderSocialMeta({
        req: fakeReq(), settings: baseSettings, availableLangs: {en: {}},
        locales: enLocales, kind: 'pad', padName: 'MyPad',
      });
      assert.equal(ogTag(html, 'og:title'), 'MyPad | Etherpad');
    });

    it('timeslider: "{padName} (history) | {siteName}"', function () {
      const html = renderSocialMeta({
        req: fakeReq(), settings: baseSettings, availableLangs: {en: {}},
        locales: enLocales, kind: 'timeslider', padName: 'MyPad',
      });
      assert.equal(ogTag(html, 'og:title'), 'MyPad (history) | Etherpad');
    });

    it('home: just the site name', function () {
      const html = renderSocialMeta({
        req: fakeReq({originalUrl: '/'}), settings: baseSettings,
        availableLangs: {en: {}}, locales: enLocales, kind: 'home',
      });
      assert.equal(ogTag(html, 'og:title'), 'Etherpad');
    });

    it('uses default site name "Etherpad" when settings.title is empty', function () {
      const html = renderSocialMeta({
        req: fakeReq(), settings: {title: '', favicon: null},
        availableLangs: {en: {}}, locales: enLocales, kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:title'), 'P | Etherpad');
    });
  });

  describe('renderSocialMeta — description from i18n', function () {
    it('exact locale match wins', function () {
      const html = renderSocialMeta({
        req: fakeReq({acceptsLanguages: () => 'de'}),
        settings: baseSettings, availableLangs: {en: {}, de: {}},
        locales: {
          en: {'pad.social.description': 'En'},
          de: {'pad.social.description': 'De'},
        },
        kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:description'), 'De');
    });

    it('region tag falls back to primary subtag', function () {
      const html = renderSocialMeta({
        req: fakeReq({acceptsLanguages: () => 'de-CH'}),
        settings: baseSettings, availableLangs: {en: {}, de: {}, 'de-CH': {}},
        locales: {
          en: {'pad.social.description': 'En'},
          de: {'pad.social.description': 'De'},
        },
        kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:description'), 'De');
    });

    it('unknown locale falls back to English', function () {
      const html = renderSocialMeta({
        req: fakeReq({acceptsLanguages: () => 'ja'}),
        settings: baseSettings, availableLangs: {en: {}, ja: {}},
        locales: {en: {'pad.social.description': 'En'}},
        kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:description'), 'En');
    });

    it('emits empty description if locale catalog has no entry', function () {
      const html = renderSocialMeta({
        req: fakeReq(), settings: baseSettings, availableLangs: {en: {}},
        locales: {}, kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:description'), '');
    });
  });

  describe('renderSocialMeta — image URL', function () {
    it('builds absolute URL to /favicon.ico when settings.favicon is null', function () {
      const html = renderSocialMeta({
        req: fakeReq(), settings: baseSettings, availableLangs: {en: {}},
        locales: enLocales, kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:image'), 'https://pad.example/favicon.ico');
    });

    it('uses settings.favicon verbatim when it is an absolute URL', function () {
      const html = renderSocialMeta({
        req: fakeReq(),
        settings: {title: 'Etherpad', favicon: 'https://cdn.example/icon.png'},
        availableLangs: {en: {}}, locales: enLocales, kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:image'), 'https://cdn.example/icon.png');
    });

    it('image:alt is "{siteName} logo"', function () {
      const html = renderSocialMeta({
        req: fakeReq(), settings: {title: 'MyPad Server', favicon: null},
        availableLangs: {en: {}}, locales: enLocales, kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:image:alt'), 'MyPad Server logo');
      assert.equal(ogTag(html, 'twitter:image:alt'), 'MyPad Server logo');
    });
  });

  describe('renderSocialMeta — URL handling', function () {
    it('builds canonical og:url from req.protocol/host/originalUrl', function () {
      const html = renderSocialMeta({
        req: fakeReq({protocol: 'http', originalUrl: '/p/Foo'}),
        settings: baseSettings, availableLangs: {en: {}}, locales: enLocales,
        kind: 'pad', padName: 'Foo',
      });
      assert.equal(ogTag(html, 'og:url'), 'http://pad.example/p/Foo');
    });

    it('strips query string from canonical og:url', function () {
      const html = renderSocialMeta({
        req: fakeReq({originalUrl: '/p/Foo?utm_source=tweet'}),
        settings: baseSettings, availableLangs: {en: {}}, locales: enLocales,
        kind: 'pad', padName: 'Foo',
      });
      assert.equal(ogTag(html, 'og:url'), 'https://pad.example/p/Foo');
    });

    it('does not double-decode pad names containing literal "%"', function () {
      // Express decodes /p/100%25 to req.params.pad === "100%". Calling
      // decodeURIComponent("100%") would throw URIError. Verify the helper
      // accepts "100%" verbatim and renders it without throwing.
      assert.doesNotThrow(() => {
        const html = renderSocialMeta({
          req: fakeReq({originalUrl: '/p/100%25'}),
          settings: baseSettings, availableLangs: {en: {}}, locales: enLocales,
          kind: 'pad', padName: '100%',
        });
        assert.equal(ogTag(html, 'og:title'), '100% | Etherpad');
      });
    });
  });

  describe('renderSocialMeta — XSS', function () {
    it('escapes < > " & in pad names', function () {
      const html = renderSocialMeta({
        req: fakeReq(), settings: baseSettings, availableLangs: {en: {}},
        locales: enLocales, kind: 'pad', padName: '<img src=x onerror=alert(1)>',
      });
      assert.ok(!html.includes('<img src=x'),
          'raw HTML must not appear in output');
      assert.ok(html.includes('&lt;img'), 'tag opener escaped');
    });

    it('escapes pad name containing a quote that could break out of content=""', function () {
      const html = renderSocialMeta({
        req: fakeReq(), settings: baseSettings, availableLangs: {en: {}},
        locales: enLocales, kind: 'pad', padName: 'X"><script>alert(1)</script>',
      });
      assert.ok(!/"><script/.test(html), 'must not allow attribute breakout');
      assert.ok(html.includes('&quot;'), 'quote escaped');
    });
  });
});
