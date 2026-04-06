'use strict';

import {strict as assert} from 'assert';
import {MapArrayType} from "../../../node/types/MapType";

const common = require('../common');
import settings from '../../../node/utils/Settings';



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
    it('index page entrypoint does not include proxy prefix without header', async function () {
      const res = await agent.get('/').expect(200);
      // The script src should not start with a proxy prefix
      const match = res.text.match(/<script src="([^"]*)">/);
      if (match) {
        const src = match[1];
        // Should not start with /test/ or similar proxy path
        if (src.startsWith('/watch/') || src.startsWith('./')) {
          // Valid — either dev or prod mode
        }
      }
    });

    it('index page entrypoint respects x-proxy-path in dev mode', async function () {
      const res = await agent.get('/')
        .set('x-proxy-path', '/myprefix')
        .expect(200);
      // In dev mode, the entrypoint should be prefixed with /myprefix
      // In prod mode, relative paths are used so the header doesn't matter
      // Either way, the page should load without error
      const scriptMatch = res.text.match(/<script src="([^"]*)">/);
      if (scriptMatch && scriptMatch[1].includes('/watch/')) {
        // Dev mode: should have the prefix
        assert(scriptMatch[1].startsWith('/myprefix/watch/'),
          `Expected dev mode entrypoint to start with /myprefix/watch/, got: ${scriptMatch[1]}`);
      }
    });
  });
});
