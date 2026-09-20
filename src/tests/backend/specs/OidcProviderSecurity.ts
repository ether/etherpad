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
  verifyInteractiveLogin,
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

    it('prefers rotated DB-backed secrets over the session-key derivation', function () {
      const rotated = ['rot-new', 'rot-old'];
      const keys = resolveOidcCookieKeys({rotatedSecrets: rotated, sessionKey: 'secret'});
      assert.deepEqual(keys, ['rot-new', 'rot-old']);
    });

    it('returns the live rotatedSecrets array by reference (so rotation propagates)', function () {
      // oidc-provider/keygrip holds the array by reference and reads it live on
      // each sign/verify, so returning the same object means a rotation that
      // mutates the array in place is picked up without reconstructing the provider.
      const rotated = ['rot-new'];
      const keys = resolveOidcCookieKeys({rotatedSecrets: rotated, sessionKey: 'secret'});
      assert.strictEqual(keys, rotated);
    });

    it('ignores an empty rotatedSecrets array and falls through', function () {
      const keys = resolveOidcCookieKeys({rotatedSecrets: [], sessionKey: 'secret'});
      assert.equal(keys.length, 1);
      assert.notEqual(keys[0], 'oidc');
      // fell through to the session-key derivation (stable, deterministic)
      assert.deepEqual(keys, resolveOidcCookieKeys({sessionKey: 'secret'}));
    });

    it('lets operator cookieKeys win over rotated secrets', function () {
      const keys = resolveOidcCookieKeys({
        cookieKeys: ['operator'], rotatedSecrets: ['rot'], sessionKey: 'secret',
      });
      assert.deepEqual(keys, ['operator']);
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

  describe('verifyInteractiveLogin', function () {
    const users = () => ({
      withPassword: {password: 'correct horse', is_admin: true},
      noPassword: {is_admin: true},
      nullPassword: {password: null, is_admin: true},
      hashOnly: {hash: '$2b$10$abcdefghijklmnopqrstuv', is_admin: true},
    });

    it('accepts the correct password', function () {
      const account = verifyInteractiveLogin(users(), 'withPassword', 'correct horse');
      assert.equal(account!.username, 'withPassword');
      assert.equal(account!.is_admin, true);
    });

    it('rejects a wrong password', function () {
      assert.equal(verifyInteractiveLogin(users(), 'withPassword', 'wrong'), null);
    });

    // An account with no `password` property used to compare against the
    // literal string "undefined", so submitting that logged it in and yielded
    // a JWT carrying its admin claim. Reported by Wenhao Wu.
    for (const password of ['undefined', 'null', '', 'anything']) {
      it(`rejects a missing password (submitted ${JSON.stringify(password)})`, function () {
        assert.equal(verifyInteractiveLogin(users(), 'noPassword', password), null);
      });

      it(`rejects a null password (submitted ${JSON.stringify(password)})`, function () {
        assert.equal(verifyInteractiveLogin(users(), 'nullPassword', password), null);
      });

      it(`rejects a hash-only account (submitted ${JSON.stringify(password)})`, function () {
        assert.equal(verifyInteractiveLogin(users(), 'hashOnly', password), null);
      });
    }

    it('rejects an unknown user', function () {
      assert.equal(verifyInteractiveLogin(users(), 'nobody', 'correct horse'), null);
    });

    it('rejects inherited properties such as __proto__ and constructor', function () {
      for (const login of ['__proto__', 'constructor', 'toString']) {
        assert.equal(verifyInteractiveLogin(users(), login, 'undefined'), null);
        assert.equal(verifyInteractiveLogin(users(), login, '[object Object]'), null);
      }
    });

    it('rejects a nullish login', function () {
      assert.equal(verifyInteractiveLogin(users(), null, 'correct horse'), null);
      assert.equal(verifyInteractiveLogin(users(), undefined, 'undefined'), null);
    });

    it('rejects when there are no users configured', function () {
      assert.equal(verifyInteractiveLogin(null, 'withPassword', 'correct horse'), null);
      assert.equal(verifyInteractiveLogin(undefined, 'withPassword', 'undefined'), null);
    });
  });
});
