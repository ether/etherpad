'use strict';

const assert = require('assert').strict;
const common = require('../../common');

let agent: any;
let apiVersion = 1;
const testPadId = `appendTextAuthor_${makeid()}`;

const endPoint = (point: string) => `/api/${apiVersion}/${point}`;

function makeid() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 10; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

describe(__filename, function () {
  let authorId: string;

  before(async function () {
    agent = await common.init();
    const res = await agent.get('/api/')
        .expect(200)
        .expect('Content-Type', /json/);
    apiVersion = res.body.currentVersion;
    assert(apiVersion);

    // Create an author
    const authorRes = await agent.get(`${endPoint('createAuthor')}?name=TestAuthor`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);
    assert.equal(authorRes.body.code, 0);
    authorId = authorRes.body.data.authorID;
    assert(authorId);

    // Create a pad
    await agent.get(`${endPoint('createPad')}?padID=${testPadId}`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);
  });

  it('appendText with authorId attributes the text to that author', async function () {
    // Append text with an authorId
    const res = await agent.post(endPoint('appendText'))
        .set('Authorization', await common.generateJWTToken())
        .send({padID: testPadId, text: 'authored text', authorId})
        .expect(200)
        .expect('Content-Type', /json/);
    assert.equal(res.body.code, 0);

    // Verify the author appears in the pad's author list
    const authorsRes = await agent.get(
        `${endPoint('listAuthorsOfPad')}?padID=${testPadId}`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);
    assert.equal(authorsRes.body.code, 0);
    assert(authorsRes.body.data.authorIDs.includes(authorId),
        `Expected authorId ${authorId} in pad authors: ${authorsRes.body.data.authorIDs}`);
  });

  it('appendText without authorId does not attribute to any author', async function () {
    const newPadId = `appendTextNoAuthor_${makeid()}`;
    await agent.get(`${endPoint('createPad')}?padID=${newPadId}`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);

    await agent.post(endPoint('appendText'))
        .set('Authorization', await common.generateJWTToken())
        .send({padID: newPadId, text: 'anonymous text'})
        .expect(200);

    const authorsRes = await agent.get(
        `${endPoint('listAuthorsOfPad')}?padID=${newPadId}`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);
    assert.equal(authorsRes.body.code, 0);
    // No authors should be listed for anonymous text
    assert.equal(authorsRes.body.data.authorIDs.length, 0);

    await agent.get(`${endPoint('deletePad')}?padID=${newPadId}`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);
  });

  after(async function () {
    await agent.get(`${endPoint('deletePad')}?padID=${testPadId}`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);
  });
});
