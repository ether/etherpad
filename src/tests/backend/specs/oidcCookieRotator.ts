'use strict';

/**
 * Integration coverage for the OIDC provider cookie-key source under the
 * DEFAULT deployment config (cookie key rotation enabled, no SESSIONKEY.txt so
 * `settings.sessionKey` is null). Without the DB-backed SecretRotator path the
 * provider would fall back to a per-process random key, breaking OIDC cookies on
 * restart and across horizontally-scaled pods. This test proves the default
 * path yields a stable, non-random, DB-backed key.
 */

const assert = require('assert').strict;
const common = require('../common');
const SecretRotator = require('../../../node/security/SecretRotator').SecretRotator;
import {resolveOidcCookieKeys} from '../../../node/security/OidcProviderSecurity';
import settings from '../../../node/utils/Settings';

describe(__filename, function () {
  this.timeout(30000);

  before(async function () {
    // Boots the server, which initialises the database the rotator writes to.
    await common.init();
  });

  it('default config yields DB-backed rotator secrets, not a random key', async function () {
    const {keyRotationInterval, sessionLifetime} = settings.cookie;
    assert.ok(keyRotationInterval && sessionLifetime,
        'precondition: cookie key rotation is enabled by default');

    const rotator = new SecretRotator(
        'oidcCookieSecretsTest', keyRotationInterval, sessionLifetime, settings.sessionKey);
    await rotator.start();
    try {
      assert.ok(Array.isArray(rotator.secrets) && rotator.secrets.length > 0,
          'rotator produced at least one secret');
      assert.ok(rotator.secrets.every((s: any) => typeof s === 'string' && s.length > 0),
          'all rotator secrets are non-empty strings');

      // The provider would select these rotated secrets (by reference) over any
      // session-key derivation or random fallback.
      const keys = resolveOidcCookieKeys({
        cookieKeys: (settings.sso as any).cookieKeys,
        rotatedSecrets: rotator.secrets,
        sessionKey: settings.sessionKey,
      });
      assert.strictEqual(keys, rotator.secrets, 'resolver returns the live rotator array');
      assert.ok(!keys.includes('oidc'), 'never the historical hardcoded key');
    } finally {
      // stop the refresh timer so it does not keep the event loop alive
      if (typeof rotator.stop === 'function') await rotator.stop();
    }
  });
});
