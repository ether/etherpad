'use strict';

/**
 * The embedded OIDC login page posts its form as JSON to /interaction/:uid.
 * express.json() is registered globally in apicalls.ts and reads that body
 * first, so the interaction handler used to pass an already consumed stream to
 * formidable, which then waited forever and the login never completed.
 */

const assert = require('assert').strict;
const common = require('../common');

describe(__filename, function () {
  this.timeout(30000);
  let agent: any;

  before(async function () { agent = await common.init(); });

  // There is no pending interaction for this uid, so the handler answers with
  // an error. What matters is that it answers instead of hanging.
  it('answers a JSON login post instead of hanging', async function () {
    const res = await agent.post('/interaction/no-such-interaction')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({login: 'admin', password: 'x'}))
        .timeout(5000);
    assert.equal(res.status, 500);
  });

  it('still answers a urlencoded login post', async function () {
    const res = await agent.post('/interaction/no-such-interaction')
        .type('form')
        .send({login: 'admin', password: 'x'})
        .timeout(5000);
    assert.equal(res.status, 500);
  });
});
