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

  describe('renderSocialMeta — settings.socialMeta.description override', function () {
    it('overrides i18n catalog regardless of negotiated language', function () {
      // Crawler sends de, catalog has both en and de entries — operator
      // override wins anyway. This is the crawler-no-Accept-Language case.
      const html = renderSocialMeta({
        req: fakeReq({acceptsLanguages: () => 'de'}),
        settings: {
          title: 'Etherpad', favicon: null,
          socialMeta: {description: 'Operator-set blurb'},
        },
        availableLangs: {en: {}, de: {}},
        locales: {
          en: {'pad.social.description': 'En catalog'},
          de: {'pad.social.description': 'De catalog'},
        },
        kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:description'), 'Operator-set blurb');
      assert.equal(ogTag(html, 'twitter:description'), 'Operator-set blurb');
    });

    it('null override falls back to i18n catalog', function () {
      const html = renderSocialMeta({
        req: fakeReq({acceptsLanguages: () => 'de'}),
        settings: {
          title: 'Etherpad', favicon: null,
          socialMeta: {description: null},
        },
        availableLangs: {en: {}, de: {}},
        locales: {
          en: {'pad.social.description': 'En'},
          de: {'pad.social.description': 'De'},
        },
        kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:description'), 'De');
    });

    it('empty / whitespace override does NOT silence the description', function () {
      // An accidental empty string in settings.json must not blank out the tag —
      // we'd lose previews entirely. Treat it as unset.
      for (const blank of ['', '   ', '\t\n']) {
        const html = renderSocialMeta({
          req: fakeReq({acceptsLanguages: () => 'en'}),
          settings: {
            title: 'Etherpad', favicon: null,
            socialMeta: {description: blank},
          },
          availableLangs: {en: {}},
          locales: {en: {'pad.social.description': 'Catalog wins'}},
          kind: 'pad', padName: 'P',
        });
        assert.equal(ogTag(html, 'og:description'), 'Catalog wins',
            `blank override (${JSON.stringify(blank)}) should fall back`);
      }
    });

    it('HTML-escapes the override (it is operator-controlled but renders into HTML)', function () {
      const html = renderSocialMeta({
        req: fakeReq(),
        settings: {
          title: 'Etherpad', favicon: null,
          socialMeta: {description: 'A & B "<C>"'},
        },
        availableLangs: {en: {}}, locales: enLocales,
        kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:description'), 'A &amp; B &quot;&lt;C&gt;&quot;');
    });

    it('missing socialMeta block is treated as unset', function () {
      // Older settings.json files won't have the socialMeta block at all.
      const html = renderSocialMeta({
        req: fakeReq({acceptsLanguages: () => 'en'}),
        settings: {title: 'Etherpad', favicon: null},
        availableLangs: {en: {}},
        locales: {en: {'pad.social.description': 'Catalog'}},
        kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:description'), 'Catalog');
    });

    it('numeric override is stringified (env-var coercion safety)', function () {
      // Settings.ts coerceValue() turns numeric-looking env vars into numbers,
      // so SOCIAL_META_DESCRIPTION="2026" arrives here as the number 2026.
      // Without stringification the resolver would silently fall back to i18n.
      const html = renderSocialMeta({
        req: fakeReq(),
        settings: {
          title: 'Etherpad', favicon: null,
          socialMeta: {description: 2026},
        },
        availableLangs: {en: {}}, locales: enLocales,
        kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:description'), '2026');
    });

    it('boolean override is stringified (covers "true"/"false" env-var coercion)', function () {
      // Less likely than the numeric case but possible: setting
      // SOCIAL_META_DESCRIPTION="true" yields a boolean. Treat it like the
      // operator wrote that literal string rather than silently dropping it.
      const html = renderSocialMeta({
        req: fakeReq(),
        settings: {
          title: 'Etherpad', favicon: null,
          socialMeta: {description: true},
        },
        availableLangs: {en: {}}, locales: enLocales,
        kind: 'pad', padName: 'P',
      });
      assert.equal(ogTag(html, 'og:description'), 'true');
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

    it('prefers settings.publicURL over request-derived origin', function () {
      const html = renderSocialMeta({
        req: fakeReq({protocol: 'http', get: (h: string) => h === 'host' ? 'evil.com' : '', originalUrl: '/p/Foo'}),
        settings: {title: 'Etherpad', favicon: null, publicURL: 'https://pad.canonical.example'},
        availableLangs: {en: {}}, locales: enLocales, kind: 'pad', padName: 'Foo',
      });
      assert.equal(ogTag(html, 'og:url'), 'https://pad.canonical.example/p/Foo');
      assert.equal(ogTag(html, 'og:image'), 'https://pad.canonical.example/favicon.ico');
    });

    it('strips trailing slash from settings.publicURL', function () {
      const html = renderSocialMeta({
        req: fakeReq({originalUrl: '/p/Foo'}),
        settings: {title: 'Etherpad', favicon: null, publicURL: 'https://pad.example///'},
        availableLangs: {en: {}}, locales: enLocales, kind: 'pad', padName: 'Foo',
      });
      assert.equal(ogTag(html, 'og:url'), 'https://pad.example/p/Foo');
    });

    it('ignores malformed settings.publicURL and falls back to request', function () {
      // No scheme, has path, contains userinfo — all rejected.
      for (const bad of ['pad.example', 'http:///foo', 'https://user@pad.example', 'javascript:alert(1)']) {
        const html = renderSocialMeta({
          req: fakeReq({originalUrl: '/p/Foo'}),
          settings: {title: 'Etherpad', favicon: null, publicURL: bad},
          availableLangs: {en: {}}, locales: enLocales, kind: 'pad', padName: 'Foo',
        });
        assert.equal(ogTag(html, 'og:url'), 'https://pad.example/p/Foo',
            `should fall back for malformed publicURL: ${bad}`);
      }
    });

    it('rejects invalid Host header values when no publicURL is configured', function () {
      // Whether a vulnerable proxy lets header injection through or not, the
      // helper must not echo a non-DNS-shaped Host into og:url.
      for (const bad of ['evil.com\r\nX-Injected: 1', 'user@evil.com', '<script>', '*']) {
        const html = renderSocialMeta({
          req: fakeReq({get: (h: string) => h === 'host' ? bad : '', originalUrl: '/p/Foo'}),
          settings: baseSettings, availableLangs: {en: {}}, locales: enLocales,
          kind: 'pad', padName: 'Foo',
        });
        const url = ogTag(html, 'og:url') || '';
        assert.ok(!url.includes('\n') && !url.includes('\r'), `CRLF leaked: ${url}`);
        assert.ok(!url.includes('<') && !url.includes('>'), `HTML leaked: ${url}`);
        assert.ok(!url.includes('@'), `userinfo leaked: ${url}`);
        assert.ok(url.startsWith('https://localhost/'), `unexpected fallback: ${url}`);
      }
    });

    it('caps protocol to http or https — no smuggled schemes', function () {
      // If something upstream lets req.protocol be a weird value (e.g. via a
      // crafted X-Forwarded-Proto), we still emit only http or https.
      const html = renderSocialMeta({
        req: fakeReq({protocol: 'javascript', originalUrl: '/p/Foo'}),
        settings: baseSettings, availableLangs: {en: {}}, locales: enLocales,
        kind: 'pad', padName: 'Foo',
      });
      const url = ogTag(html, 'og:url') || '';
      assert.ok(url.startsWith('http://') || url.startsWith('https://'),
          `unexpected scheme in og:url: ${url}`);
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
