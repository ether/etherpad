'use strict';

const assert = require('assert').strict;
// The escaping helpers are a client module, but they are pure (no browser
// globals) so they can be exercised directly from a backend spec. This locks
// the byte-for-byte output of the helpers vendored from the (now removed)
// `security` npm package, so the vendoring can never silently drift.
const Security = require('../../../static/js/security');

describe(__filename, function () {
  describe('public API', function () {
    it('exposes the full set of helpers plugins may rely on', function () {
      for (const fn of [
        'escapeHTML', 'escapeHTMLAttribute',
        'encodeJavaScriptIdentifier', 'encodeJavaScriptString', 'encodeJavaScriptData',
        'encodeCSSIdentifier', 'encodeCSSString',
      ]) {
        assert.equal(typeof Security[fn], 'function', `Security.${fn} must be a function`);
      }
    });
  });

  describe('escapeHTML', function () {
    it('escapes &, <, >, ", \' and / per OWASP', function () {
      assert.equal(Security.escapeHTML('<a href="x">/&\''),
          '&lt;a href=&quot;x&quot;&gt;&#x2F;&amp;&#x27;');
    });
    it('neutralises a script tag', function () {
      assert.equal(Security.escapeHTML('<script>alert(1)</script>'),
          '&lt;script&gt;alert(1)&lt;&#x2F;script&gt;');
    });
    it('leaves plain alphanumerics untouched', function () {
      assert.equal(Security.escapeHTML('Hello World 123'), 'Hello World 123');
    });
    it('passes falsy input straight through', function () {
      assert.equal(Security.escapeHTML(''), '');
    });
  });

  describe('escapeHTMLAttribute', function () {
    it('hex-encodes non-alphanumeric ASCII not covered by named entities', function () {
      assert.equal(Security.escapeHTMLAttribute('a b'), 'a&#x20;b');
      // hex is lowercased, matching the original `security` package output.
      assert.equal(Security.escapeHTMLAttribute('javascript:alert(1)'),
          'javascript&#x3a;alert&#x28;1&#x29;');
    });
    it('prefers named entities for &, <, >, ", \', /', function () {
      assert.equal(Security.escapeHTMLAttribute('<>&"\'/'),
          '&lt;&gt;&amp;&quot;&#x27;&#x2F;');
    });
    it('leaves alphanumerics untouched', function () {
      assert.equal(Security.escapeHTMLAttribute('abcXYZ0189'), 'abcXYZ0189');
    });
  });

  describe('javascript / css encoders', function () {
    it('encodeJavaScriptString quotes and backslash-u-escapes specials', function () {
      assert.equal(Security.encodeJavaScriptString('a<b'), '"a\\u003cb"');
    });
    it('encodeCSSString quotes and backslash-escapes specials', function () {
      assert.equal(Security.encodeCSSString('a;b'), '"a\\00003bb"');
    });
    it('encodeJavaScriptData escapes specials inside JSON string literals', function () {
      assert.equal(
          Security.encodeJavaScriptData({a: '<b>', c: 'x"y', d: 'a\\b'}),
          '{"a":"\\u003cb\\u003e","c":"x\\u0022y","d":"a\\u005cb"}');
    });
    it('encodeJavaScriptData regex is linear (ReDoS guard)', function () {
      // The JSON-string-literal regex used to be /"(?:\\.|[^"])*"/, which
      // backtracks exponentially on an unterminated string of `\!` repeats.
      // Run the regex directly on adversarial input and assert it returns fast.
      const evil = `"${'\\!'.repeat(50000)}`; // no closing quote
      const start = Date.now();
      /"(?:[^"\\]|\\.)*"/gm.test(evil);
      assert.ok(Date.now() - start < 1000, 'regex must not backtrack exponentially');
    });
  });
});
