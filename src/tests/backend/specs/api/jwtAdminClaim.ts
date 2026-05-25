'use strict';

/**
 * Coverage for the JWT admin-claim check on the OAuth-authenticated API.
 *
 * The authorization_code path must require `payload.admin === true`
 * after signature verification. Tokens whose admin claim is missing,
 * false, or otherwise non-true must be rejected with 401, and a
 * tampered/unsigned token must also be rejected.
 */

const common = require('../../common');
import settings from '../../../../node/utils/Settings.js';

let agent: any;

const apiVersion = '1.3.1';

describe(__filename, function () {
  before(async function () { agent = await common.init(); });

  describe('JWT admin claim enforcement (authorization_code grant)', function () {
    let originalAuthMethod: string;

    before(function () {
      // Force the OAuth path for these tests.
      originalAuthMethod = settings.authenticationMethod;
      settings.authenticationMethod = 'sso';
    });

    after(function () {
      settings.authenticationMethod = originalAuthMethod;
    });

    it('rejects a token with admin=false', async function () {
      const token = await common.generateJWTTokenAdminFalse();
      // listAllPads is a representative admin-only API call.
      const res = await agent
          .get(`/api/${apiVersion}/listAllPads`)
          .set('Authorization', `Bearer ${token}`)
          .expect(401);
      if (!/OAuth|admin/i.test(res.text || JSON.stringify(res.body))) {
        throw new Error(
            `Expected an auth-related error message, got: ` +
            `${res.text || JSON.stringify(res.body)}`);
      }
    });

    it('rejects a token with no admin claim', async function () {
      const token = await common.generateJWTTokenUser();
      await agent
          .get(`/api/${apiVersion}/listAllPads`)
          .set('Authorization', `Bearer ${token}`)
          .expect(401);
    });

    it('accepts a token with admin=true (happy path)', async function () {
      const token = await common.generateJWTToken();
      await agent
          .get(`/api/${apiVersion}/listAllPads`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
    });

    it('rejects an unsigned / tampered token', async function () {
      const fake =
          'eyJhbGciOiJSUzI1NiJ9.' +
          // base64({admin:true,sub:"admin",exp:9999999999})
          'eyJhZG1pbiI6dHJ1ZSwic3ViIjoiYWRtaW4iLCJleHAiOjk5OTk5OTk5OTl9.' +
          'AAAA';
      await agent
          .get(`/api/${apiVersion}/listAllPads`)
          .set('Authorization', `Bearer ${fake}`)
          .expect(401);
    });

    it('rejects a request with no Authorization header', async function () {
      await agent
          .get(`/api/${apiVersion}/listAllPads`)
          .expect(401);
    });
  });
});
