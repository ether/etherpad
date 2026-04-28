'use strict';

import {strict as assert} from 'assert';

const common = require('../../common');

let agent: any;
let apiVersion = 1;
const endPoint = (point: string) => `/api/${apiVersion}/${point}`;

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

  it('anonymizeAuthor zeroes the author and returns counters', async function () {
    const create = await callApi('createAuthor', {name: 'Alice'});
    assert.equal(create.body.code, 0);
    const authorID = create.body.data.authorID;

    const res = await callApi('anonymizeAuthor', {authorID});
    assert.equal(res.body.code, 0, JSON.stringify(res.body));
    assert.ok(res.body.data.affectedPads >= 0);

    const name = await callApi('getAuthorName', {authorID});
    // getAuthorName returns the raw string/null directly in `data`.
    // Post-erasure, the name is null.
    assert.equal(name.body.data, null);
  });

  it('anonymizeAuthor with missing authorID returns an error', async function () {
    const res = await agent.get(`${endPoint('anonymizeAuthor')}?authorID=`)
        .set('authorization', await common.generateJWTToken())
        .expect(200)
        .expect('Content-Type', /json/);
    assert.equal(res.body.code, 1);
    assert.match(res.body.message, /authorID is required/);
  });
});
