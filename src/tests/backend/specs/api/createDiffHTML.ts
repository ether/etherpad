'use strict';

const assert = require('assert').strict;
const common = require('../../common');

let agent: any;
let apiVersion = 1;
const testPadId = `createDiffHTML_${Date.now()}`;

const endPoint = (point: string) => `/api/${apiVersion}/${point}`;

describe(__filename, function () {
  before(async function () {
    agent = await common.init();
    const res = await agent.get('/api/')
        .expect(200)
        .expect('Content-Type', /json/);
    apiVersion = res.body.currentVersion;
    assert(apiVersion);

    // Create pad with multiple revisions for diff testing
    await agent.get(`${endPoint('createPad')}?padID=${testPadId}`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);

    await agent.post(endPoint('setText'))
        .set('Authorization', await common.generateJWTToken())
        .send({padID: testPadId, text: 'first revision'})
        .expect(200);

    await agent.post(endPoint('setText'))
        .set('Authorization', await common.generateJWTToken())
        .send({padID: testPadId, text: 'second revision'})
        .expect(200);
  });

  it('createDiffHTML between two different revisions', async function () {
    const res = await agent.get(
        `${endPoint('createDiffHTML')}?padID=${testPadId}&startRev=1&endRev=2`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200)
        .expect('Content-Type', /json/);
    assert.equal(res.body.code, 0);
    assert(res.body.data.html);
    assert(Array.isArray(res.body.data.authors));
  });

  it('createDiffHTML with same startRev and endRev', async function () {
    const res = await agent.get(
        `${endPoint('createDiffHTML')}?padID=${testPadId}&startRev=1&endRev=1`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200)
        .expect('Content-Type', /json/);
    assert.equal(res.body.code, 0);
    assert(res.body.data.html);
  });

  it('createDiffHTML from rev 0 to latest', async function () {
    const res = await agent.get(
        `${endPoint('createDiffHTML')}?padID=${testPadId}&startRev=0&endRev=2`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200)
        .expect('Content-Type', /json/);
    assert.equal(res.body.code, 0);
    assert(res.body.data.html);
  });

  after(async function () {
    await agent.get(`${endPoint('deletePad')}?padID=${testPadId}`)
        .set('Authorization', await common.generateJWTToken());
  });
});
