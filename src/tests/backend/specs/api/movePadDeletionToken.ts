'use strict';

import {strict as assert} from 'assert';

const common = require('../../common');
const padDeletionManager = require('../../../../node/db/PadDeletionManager');

let agent: any;
let apiVersion = 1;

const endPoint = (p: string) => `/api/${apiVersion}/${p}`;

const makeId = () => `movetok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  it('movePad carries the deletionToken to the destination (issue #7995)', async function () {
    const srcId = makeId();
    const dstId = `${srcId}_dst`;
    const create = await callApi('createPad', {padID: srcId});
    const token = create.body.data.deletionToken;
    assert.equal(typeof token, 'string');

    const move = await callApi('movePad', {sourceID: srcId, destinationID: dstId});
    assert.equal(move.body.code, 0, JSON.stringify(move.body));

    const del = await callApi('deletePad', {padID: dstId, deletionToken: token});
    assert.equal(del.body.code, 0, JSON.stringify(del.body));
  });

  it('the moved pad does not offer its creator a second token (issue #7995)', async function () {
    const srcId = makeId();
    const dstId = `${srcId}_dst`;
    await callApi('createPad', {padID: srcId});
    await callApi('movePad', {sourceID: srcId, destinationID: dstId});

    // This is what the creator's next CLIENT_READY does. A non-null result here
    // is exactly the second "save your pad deletion token" modal they reported.
    assert.equal(await padDeletionManager.createDeletionTokenIfAbsent(dstId), null);

    await callApi('deletePad', {padID: dstId});
  });

  it('movePad --force replaces the destination pad\'s own token', async function () {
    const srcId = makeId();
    const dstId = `${srcId}_existing`;
    const src = await callApi('createPad', {padID: srcId});
    const dst = await callApi('createPad', {padID: dstId});
    const srcToken = src.body.data.deletionToken;
    const dstToken = dst.body.data.deletionToken;
    assert.notEqual(srcToken, dstToken);

    await callApi('movePad', {sourceID: srcId, destinationID: dstId, force: 'true'});

    // The overwritten pad's content is gone, so its old token must be too.
    const stale = await callApi('deletePad', {padID: dstId, deletionToken: dstToken});
    assert.equal(stale.body.code, 1, JSON.stringify(stale.body));
    const del = await callApi('deletePad', {padID: dstId, deletionToken: srcToken});
    assert.equal(del.body.code, 0, JSON.stringify(del.body));
  });

  it('copyPad does NOT share the source deletionToken with the copy', async function () {
    const srcId = makeId();
    const dstId = `${srcId}_copy`;
    const create = await callApi('createPad', {padID: srcId});
    const token = create.body.data.deletionToken;

    const copy = await callApi('copyPad', {sourceID: srcId, destinationID: dstId});
    assert.equal(copy.body.code, 0, JSON.stringify(copy.body));

    const del = await callApi('deletePad', {padID: dstId, deletionToken: token});
    assert.equal(del.body.code, 1, JSON.stringify(del.body));
    assert.match(del.body.message, /invalid deletionToken/);

    // cleanup
    await callApi('deletePad', {padID: srcId});
    await callApi('deletePad', {padID: dstId});
  });
});
