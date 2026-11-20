'use strict';

const common = require('../common');

describe(__filename, function () {
  this.timeout(30000);
  let agent: any;
  before(async function () { agent = await common.init(); });

  describe('/ep/pad/connection-diagnostic-info', function () {
    it('POST with valid diagnosticInfo returns 200', async function () {
      await agent.post('/ep/pad/connection-diagnostic-info')
        .send({diagnosticInfo: {disconnectedMessage: 'socket.io timeout'}})
        .expect(200);
    });

    it('POST without diagnosticInfo returns 400', async function () {
      await agent.post('/ep/pad/connection-diagnostic-info')
        .send({})
        .expect(400);
    });

    it('POST with deeply nested diagnosticInfo returns 200', async function () {
      const depth = 16000; // ~96KB, under the express.json() limit
      const body = `{"diagnosticInfo":${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}}`;
      await agent.post('/ep/pad/connection-diagnostic-info')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(200);
    });
  });

  describe('/jserror', function () {
    it('accepts a normal error report', async function () {
      await agent.post('/jserror')
        .field('errorInfo', JSON.stringify({msg: 'boom', stack: 'at x'}))
        .expect(200);
    });

    it('rejects an oversized error report', async function () {
      await agent.post('/jserror')
        .field('errorInfo', JSON.stringify({msg: 'boom', pad: 'x'.repeat(200 * 1024)}))
        .expect(413);
    });
  });
});
