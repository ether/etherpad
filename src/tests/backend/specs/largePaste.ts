'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import assert from 'assert';
import common from '../common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let agent: any;
let apiVersion = 1;

describe(__filename, function () {
  before(async function () {
    agent = await common.init();
    const res = await agent.get('/api/')
        .expect(200)
        .expect('Content-Type', /json/);
    apiVersion = res.body.currentVersion;
    assert(apiVersion);
  });

  it('can set and retrieve 50,000 characters of text on a pad', async function () {
    this.timeout(30000);
    const padId = `largePasteTest${Date.now()}`;
    const largeText = 'A'.repeat(50000);

    // Create the pad
    let res = await agent.get(`/api/${apiVersion}/createPad?padID=${padId}`)
        .set('Authorization', (await common.generateJWTToken()))
        .expect(200)
        .expect('Content-Type', /json/);
    assert.equal(res.body.code, 0);

    // Set large text
    res = await agent.post(`/api/${apiVersion}/setText`)
        .set('Authorization', (await common.generateJWTToken()))
        .send({padID: padId, text: largeText})
        .expect(200)
        .expect('Content-Type', /json/);
    assert.equal(res.body.code, 0);

    // Retrieve and verify
    res = await agent.get(`/api/${apiVersion}/getText?padID=${padId}`)
        .set('Authorization', (await common.generateJWTToken()))
        .expect(200)
        .expect('Content-Type', /json/);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.text, largeText + '\n');

    // Clean up
    await agent.get(`/api/${apiVersion}/deletePad?padID=${padId}`)
        .set('Authorization', (await common.generateJWTToken()))
        .expect(200);
  });
});
