'use strict';

/**
 * Unit coverage for the embedded OIDC provider's cookie-signing key derivation
 * and CORS origin allow-list. Both were reported by `meifukun`:
 *   - the provider historically signed its cookies with the hardcoded key
 *     `['oidc']`, so anyone with the public source could forge valid `.sig`
 *     cookies;
 *   - `clientBasedCORS` returned `true` for every origin, reflecting arbitrary
 *     `Origin` values into `Access-Control-Allow-Origin`.
 */

const assert = require('assert').strict;
import {
  resolveOidcCookieKeys,
  isOriginAllowedForOidcClient,
} from '../../../node/security/OidcProviderSecurity';

describe(__filename, function () {
  describe('resolveOidcCookieKeys', function () {
    it('never returns the historical hardcoded key', function () {
      const keys = resolveOidcCookieKeys({sessionKey: 'a-persisted-session-secret'});
      assert.ok(!keys.includes('oidc'));
    });

    it('uses operator-supplied cookieKeys when provided', function () {
      const keys = resolveOidcCookieKeys({cookieKeys: ['k1', 'k2'], sessionKey: 'x'});
      assert.deepEqual(keys, ['k1', 'k2']);
    });

    it('ignores empty/invalid entries in cookieKeys and falls through', function () {
      const keys = resolveOidcCookieKeys({cookieKeys: ['', null as any], sessionKey: 'secret'});
      assert.equal(keys.length, 1);
      assert.notEqual(keys[0], 'oidc');
      assert.ok(keys[0].length >= 32);
    });

    it('derives a stable key from the session secret (survives restart/multi-pod)', function () {
      const a = resolveOidcCookieKeys({sessionKey: 'secret'});
      const b = resolveOidcCookieKeys({sessionKey: 'secret'});
      assert.deepEqual(a, b);
    });

    it('derives different keys for different session secrets', function () {
      const a = resolveOidcCookieKeys({sessionKey: 'secret-a'});
      const b = resolveOidcCookieKeys({sessionKey: 'secret-b'});
      assert.notDeepEqual(a, b);
    });

    it('does not reuse the raw session secret as the cookie key', function () {
      const keys = resolveOidcCookieKeys({sessionKey: 'secret'});
      assert.ok(!keys.includes('secret'));
    });

    it('falls back to a fresh random key when no session secret exists', function () {
      const a = resolveOidcCookieKeys({sessionKey: null});
      const b = resolveOidcCookieKeys({sessionKey: null});
      assert.equal(a.length, 1);
      assert.notEqual(a[0], 'oidc');
      assert.ok(a[0].length >= 32);
      assert.notDeepEqual(a, b); // random => different each call
    });
  });

  describe('isOriginAllowedForOidcClient', function () {
    const client = {
      redirectUris: ['https://app.example.com/admin/', 'https://app.example.com/'],
    };

    it('allows an origin matching a registered redirect URI', function () {
      assert.equal(isOriginAllowedForOidcClient('https://app.example.com', client), true);
    });

    it('rejects an unregistered attacker origin', function () {
      assert.equal(isOriginAllowedForOidcClient('https://evil.attacker.com', client), false);
    });

    it('rejects a look-alike suffix origin (no substring matching)', function () {
      assert.equal(isOriginAllowedForOidcClient('https://app.example.com.evil.com', client), false);
    });

    it('rejects a scheme mismatch (http vs https)', function () {
      assert.equal(isOriginAllowedForOidcClient('http://app.example.com', client), false);
    });

    it('rejects when origin is missing', function () {
      assert.equal(isOriginAllowedForOidcClient(undefined, client), false);
    });

    it('rejects when client is missing', function () {
      assert.equal(isOriginAllowedForOidcClient('https://app.example.com', null), false);
    });

    it('rejects when client has no redirect URIs', function () {
      assert.equal(isOriginAllowedForOidcClient('https://app.example.com', {}), false);
    });
  });
});
