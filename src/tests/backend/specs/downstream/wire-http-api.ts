'use strict';

/**
 * Snapshots the *shapes* (keys/types, not volatile values) of the HTTP API
 * endpoints downstream clients call to create pads and round-trip text.
 * Auth in the test harness is via JWT (common.generateJWTToken), matching the
 * rest of the api specs — see api/createDiffHTML.ts.
 */

const assert = require('assert').strict;
const common = require('../../common');

describe(__filename, function () {
  let agent: any;
  let apiVersion = 1;
  const padId = `wireHttp_${common.randomString()}`;
  const endPoint = (point: string) => `/api/${apiVersion}/${point}`;

  before(async function () {
    agent = await common.init();
    const res = await agent.get('/api/').expect(200).expect('Content-Type', /json/);
    apiVersion = res.body.currentVersion;
    assert(apiVersion);
  });

  it('createPad returns the standard {code,data,message} envelope', async function () {
    const res = await agent.get(`${endPoint('createPad')}?padID=${padId}&text=hello%0A`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);
    assert.deepEqual(Object.keys(res.body).sort(), ['code', 'data', 'message']);
    assert.equal(res.body.code, 0);
  });

  it('setText + getText round-trips text through the documented shape', async function () {
    await agent.post(endPoint('setText'))
        .set('Authorization', await common.generateJWTToken())
        .send({padID: padId, text: 'world\n'})
        .expect(200);
    const res = await agent.get(`${endPoint('getText')}?padID=${padId}`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);
    assert.equal(res.body.code, 0);
    assert.equal(typeof res.body.data.text, 'string');
    assert.equal(res.body.data.text, 'world\n');
  });

  it('getRevisionsCount exposes a numeric revisions field', async function () {
    const res = await agent.get(`${endPoint('getRevisionsCount')}?padID=${padId}`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);
    assert.equal(res.body.code, 0);
    assert.equal(typeof res.body.data.revisions, 'number');
  });
});
