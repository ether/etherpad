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
  alreadyParsedBody,
  resolveOidcCookieKeys,
  isOriginAllowedForOidcClient,
  verifyInteractiveLogin,
  clientCredentialsClaims,
  isApiTokenAuthorized,
  GRANT_CLAIM,
} from '../../../node/security/OidcProviderSecurity';
import {exportedForTestingOnly} from '../../../node/utils/Settings';
import fs from 'fs';
import os from 'os';
import path from 'path';

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

    // Reported by Wenhao Wu alongside GHSA-62cj-9j72-mfrh: an account with
    // `"password": ""` authenticated anyone who submitted an empty password,
    // on both this path and HTTP Basic. Only misconfiguration produces it,
    // but it should fail closed.
    it('rejects an empty-string password', function () {
      const u = {empty: {password: '', is_admin: true}};
      assert.equal(verifyInteractiveLogin(u, 'empty', ''), null);
      assert.equal(verifyInteractiveLogin(u, 'empty', 'anything'), null);
    });

    // #8263: the settings loader coerces env-var values, so
    // `"password": "${ADMIN_PASSWORD:null}"` with ADMIN_PASSWORD=123456 yields
    // the number 123456 (and "true"/"false" yield booleans). HTTP Basic always
    // compared via toString(); the interactive login must accept them too.
    it('accepts a password the settings loader coerced to a number or boolean', function () {
      const u = {num: {password: 123456}, zero: {password: 0}, bool: {password: true}};
      assert.equal(verifyInteractiveLogin(u, 'num', '123456')!.username, 'num');
      assert.equal(verifyInteractiveLogin(u, 'zero', '0')!.username, 'zero');
      assert.equal(verifyInteractiveLogin(u, 'bool', 'true')!.username, 'bool');
      assert.equal(verifyInteractiveLogin(u, 'num', '12345'), null);
      assert.equal(verifyInteractiveLogin(u, 'bool', 'false'), null);
    });

    // End to end through the real settings loader, the way the Docker image
    // configures the admin account (`settings.json.docker`).
    for (const [envVal, submitted] of [['123456', '123456'], ['true', 'true'], ['s3cret', 's3cret']]) {
      it(`logs in with ADMIN_PASSWORD=${envVal} substituted by the settings loader`, function () {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-8263-'));
        const file = path.join(dir, 'settings.json');
        fs.writeFileSync(file, JSON.stringify({
          users: {admin: {password: '${EP_TEST_8263_PASSWORD:null}', is_admin: true}},
        }));
        process.env.EP_TEST_8263_PASSWORD = envVal;
        try {
          const s: any = exportedForTestingOnly.parseSettings(file, true);
          assert.equal(verifyInteractiveLogin(s.users, 'admin', submitted)!.username, 'admin');
          assert.equal(verifyInteractiveLogin(s.users, 'admin', 'wrong'), null);
        } finally {
          delete process.env.EP_TEST_8263_PASSWORD;
          fs.rmSync(dir, {recursive: true, force: true});
        }
      });
    }

    it('rejects non-scalar passwords', function () {
      const u = {obj: {password: {}}, arr: {password: []}, nan: {password: NaN}};
      assert.equal(verifyInteractiveLogin(u, 'obj', '[object Object]'), null);
      assert.equal(verifyInteractiveLogin(u, 'arr', ''), null);
      assert.equal(verifyInteractiveLogin(u, 'nan', 'NaN'), null);
    });

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
  describe('isApiTokenAuthorized', function () {
    const clientIds = ['admin_client', 'user'];

    it('accepts an admin user token', function () {
      assert.equal(isApiTokenAuthorized({sub: 'admin', admin: true}, clientIds), true);
    });

    it('rejects a non-admin user token whose sub collides with a client_id', function () {
      assert.equal(isApiTokenAuthorized({sub: 'user', admin: false}, clientIds), false);
      assert.equal(isApiTokenAuthorized({sub: 'user'}, clientIds), false);
    });

    it('accepts a marked client_credentials token for a configured client', function () {
      assert.equal(isApiTokenAuthorized(
          {sub: 'admin_client', [GRANT_CLAIM]: 'client_credentials'}, clientIds), true);
    });

    it('rejects a marked token whose sub is not a configured client', function () {
      assert.equal(isApiTokenAuthorized(
          {sub: 'admin', [GRANT_CLAIM]: 'client_credentials'}, clientIds), false);
      assert.equal(isApiTokenAuthorized({[GRANT_CLAIM]: 'client_credentials'}, clientIds), false);
    });

    it('treats any other marker value as a user token', function () {
      assert.equal(isApiTokenAuthorized(
          {sub: 'admin_client', [GRANT_CLAIM]: 'other'}, clientIds), false);
    });

    it('rejects a missing payload', function () {
      assert.equal(isApiTokenAuthorized(null, clientIds), false);
    });
  });

  describe('clientCredentialsClaims', function () {
    const clients = [
      {client_id: 'a', extraParams: [{name: 'scope', value: 'x'}]},
      {client_id: 'b', extraParams: [{name: GRANT_CLAIM, value: 'forged'}]},
    ];

    it('adds the matching client extraParams and the grant marker', function () {
      assert.deepEqual(clientCredentialsClaims(clients, 'a'),
          {scope: 'x', [GRANT_CLAIM]: 'client_credentials'});
    });

    it('does not let a configured extraParam override the marker', function () {
      assert.deepEqual(clientCredentialsClaims(clients, 'b'),
          {[GRANT_CLAIM]: 'client_credentials'});
    });

    it('tolerates missing client configuration', function () {
      assert.deepEqual(clientCredentialsClaims(undefined, 'a'),
          {[GRANT_CLAIM]: 'client_credentials'});
    });
  });

  describe('alreadyParsedBody', function () {
    it('returns the body a JSON parser already produced', function () {
      const body = {login: 'admin', password: 'pw'};
      assert.equal(alreadyParsedBody({body, readableEnded: true}), body);
    });

    it('returns an empty object for a consumed stream with no body', function () {
      assert.deepEqual(alreadyParsedBody({readableEnded: true}), {});
    });

    it('returns null when the stream still needs parsing', function () {
      assert.equal(alreadyParsedBody({readableEnded: false}), null);
      assert.equal(alreadyParsedBody({}), null);
    });
  });
});
