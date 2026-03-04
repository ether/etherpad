'use strict';

import {MapArrayType} from "../../../node/types/MapType";

const assert = require('assert').strict;
const common = require('../common');
import settings, {
  getEpVersion
} from '../../../node/utils/Settings';
const superagent = require('superagent');

describe(__filename, function () {
  let agent:any;
  const backup:MapArrayType<any> = {};

  const getHealth = () => agent.get('/health')
      .accept('application/health+json')
      .buffer(true)
      .parse(superagent.parse['application/json'])
      .expect(200)
      .expect((res:any) => assert.equal(res.type, 'application/health+json'));

  before(async function () {
    agent = await common.init();
  });

  beforeEach(async function () {
    backup.settings = {};
    for (const setting of ['requireAuthentication', 'requireAuthorization']) {
      // @ts-ignore
      backup.settings[setting] = settings[setting];
    }
  });

  afterEach(async function () {
    Object.assign(settings, backup.settings);
  });

  it('/health works', async function () {
    const res = await getHealth();
    assert.equal(res.body.status, 'pass');
    assert.equal(res.body.releaseId, getEpVersion());
  });

  it('auth is not required', async function () {
    settings.requireAuthentication = true;
    settings.requireAuthorization = true;
    const res = await getHealth();
    assert.equal(res.body.status, 'pass');
  });

  // We actually want to test that no express-session state is created, but that is difficult to do
  // without intrusive changes or unpleasant ueberdb digging. Instead, we assume that the lack of a
  // cookie means that no express-session state was created (how would express-session look up the
  // session state if no ID was returned to the client?).
  it('no cookie is returned', async function () {
    const res = await getHealth();
    const cookie = res.headers['set-cookie'];
    assert(cookie == null, `unexpected Set-Cookie: ${cookie}`);
  });
});
