'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {strict as assert} from 'assert';
import {MapArrayType} from "../../../node/types/MapType";

import common from '../common.js';
import settings from '../../../node/utils/Settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);



describe(__filename, function () {
  this.timeout(30000);
  let agent:any;
  const backups:MapArrayType<any> = {};
  before(async function () { agent = await common.init(); });
  beforeEach(async function () {
    backups.settings = {};
    for (const setting of ['requireAuthentication', 'requireAuthorization']) {
      // @ts-ignore
      backups.settings[setting] = settings[setting];
    }
    settings.requireAuthentication = false;
    settings.requireAuthorization = false;
  });
  afterEach(async function () {
    Object.assign(settings, backups.settings);
  });

  describe('/javascript', function () {
    it('/javascript -> 200', async function () {
      await agent.get('/javascript').expect(200);
    });
  });

  describe('x-proxy-path header', function () {
    it('index page contains a script entrypoint', async function () {
      const res = await agent.get('/').expect(200);
      const match = res.text.match(/<script src="([^"]*)">/);
      assert(match, 'Expected a <script src="..."> tag in the index page');
      // In production mode, entrypoint should be a relative path
      assert(!match[1].startsWith('/watch/'),
        `Production entrypoint should not be an absolute /watch/ path, got: ${match[1]}`);
    });

    it('index page loads with x-proxy-path header', async function () {
      await agent.get('/')
        .set('x-proxy-path', '/myprefix')
        .expect(200);
    });

    it('pad page loads with x-proxy-path header', async function () {
      await agent.get('/p/testpad')
        .set('x-proxy-path', '/myprefix')
        .expect(200);
    });
  });
});
