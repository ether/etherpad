'use strict';

import {strict as assert} from 'assert';

const common = require('../../common');
import settings from '../../../../node/utils/Settings';

let agent: any;
let apiVersion = 1;

const endPoint = (p: string) => `/api/${apiVersion}/${p}`;

const makeId = () => `gdprdel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const callApi = async (point: string, query: Record<string, string> = {}) => {
  const qs = new URLSearchParams(query).toString();
  const path = qs ? `${endPoint(point)}?${qs}` : endPoint(point);
  return await agent.get(path)
      .set('authorization', await common.generateJWTToken())
      .expect(200)
      .expect('Content-Type', /json/);
};

describe(__filename, function () {
  before(async function () {
    this.timeout(60000);
    agent = await common.init();
    const res = await agent.get('/api/').expect(200);
    apiVersion = res.body.currentVersion;
  });

  afterEach(function () {
    settings.allowPadDeletionByAllUsers = false;
    settings.requireAuthentication = false;
  });

  it('createPad returns a plaintext deletionToken the first time', async function () {
    const padId = makeId();
    const res = await callApi('createPad', {padID: padId});
    assert.equal(res.body.code, 0, JSON.stringify(res.body));
    assert.equal(typeof res.body.data.deletionToken, 'string');
    assert.ok(res.body.data.deletionToken.length >= 32);
    await callApi('deletePad', {padID: padId, deletionToken: res.body.data.deletionToken});
  });

  it('deletePad with a valid deletionToken succeeds', async function () {
    const padId = makeId();
    const create = await callApi('createPad', {padID: padId});
    const token = create.body.data.deletionToken;
    const del = await callApi('deletePad', {padID: padId, deletionToken: token});
    assert.equal(del.body.code, 0, JSON.stringify(del.body));
    const check = await callApi('getText', {padID: padId});
    assert.equal(check.body.code, 1); // "padID does not exist"
  });

  it('deletePad with a wrong deletionToken is refused', async function () {
    const padId = makeId();
    await callApi('createPad', {padID: padId});
    const del = await callApi('deletePad', {padID: padId, deletionToken: 'not-the-real-token'});
    assert.equal(del.body.code, 1);
    assert.match(del.body.message, /invalid deletionToken/);
    // cleanup — JWT-authenticated caller is trusted when no token is supplied
    await callApi('deletePad', {padID: padId});
  });

  it('deletePad with allowPadDeletionByAllUsers=true bypasses the token check', async function () {
    const padId = makeId();
    await callApi('createPad', {padID: padId});
    settings.allowPadDeletionByAllUsers = true;
    const del = await callApi('deletePad', {padID: padId, deletionToken: 'bogus'});
    assert.equal(del.body.code, 0);
  });

  it('createPad returns null deletionToken when requireAuthentication is on', async function () {
    settings.requireAuthentication = true;
    const padId = makeId();
    const res = await callApi('createPad', {padID: padId});
    assert.equal(res.body.code, 0, JSON.stringify(res.body));
    assert.equal(res.body.data.deletionToken, null);
    await callApi('deletePad', {padID: padId});
  });

  it('JWT admin call (no deletionToken) still works — admins stay trusted', async function () {
    const padId = makeId();
    await callApi('createPad', {padID: padId});
    const del = await callApi('deletePad', {padID: padId});
    assert.equal(del.body.code, 0);
  });
});
