'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import * as common from '../common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  });
});
