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

  describe('theme-color meta', function () {
    const backups:MapArrayType<any> = {};
    beforeEach(function () {
      backups.skinName = settings.skinName;
      backups.skinVariants = settings.skinVariants;
    });
    afterEach(function () {
      settings.skinName = backups.skinName;
      settings.skinVariants = backups.skinVariants;
    });

    it('pad page emits theme-color matching the configured colibris toolbar', async function () {
      settings.skinName = 'colibris';
      settings.skinVariants = 'super-light-toolbar super-light-editor light-background';
      const res = await agent.get('/p/testpad').expect(200);
      assert.match(res.text, /<meta name="theme-color" content="#ffffff">/);
      // No media-query variants — runtime dark-mode also depends on localStorage,
      // which a server-rendered media query cannot account for.
      assert.doesNotMatch(res.text, /prefers-color-scheme/);
    });

    it('pad page tracks an explicit dark toolbar variant', async function () {
      settings.skinName = 'colibris';
      settings.skinVariants = 'dark-toolbar dark-editor dark-background';
      const res = await agent.get('/p/testpad').expect(200);
      assert.match(res.text, /<meta name="theme-color" content="#576273">/);
    });

    it('pad page omits theme-color for non-colibris skins', async function () {
      settings.skinName = 'no-skin';
      settings.skinVariants = 'super-light-toolbar';
      const res = await agent.get('/p/testpad').expect(200);
      assert.doesNotMatch(res.text, /theme-color/);
    });

    it('timeslider page emits theme-color matching the configured toolbar', async function () {
      settings.skinName = 'colibris';
      settings.skinVariants = 'super-dark-toolbar super-dark-editor dark-background';
      const res = await agent.get('/p/testpad/timeslider').expect(200);
      assert.match(res.text, /<meta name="theme-color" content="#485365">/);
      assert.doesNotMatch(res.text, /prefers-color-scheme/);
    });

    it('timeslider page omits theme-color for non-colibris skins', async function () {
      settings.skinName = 'no-skin';
      settings.skinVariants = 'super-light-toolbar';
      const res = await agent.get('/p/testpad/timeslider').expect(200);
      assert.doesNotMatch(res.text, /theme-color/);
    });
  });
});
