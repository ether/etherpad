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
      backups.enableDarkMode = settings.enableDarkMode;
    });
    afterEach(function () {
      settings.skinName = backups.skinName;
      settings.skinVariants = backups.skinVariants;
      settings.enableDarkMode = backups.enableDarkMode;
    });

    it('pad page emits a light baseline and a media-scoped dark variant', async function () {
      // Issue #7606: iOS Safari colors the address bar at parse time and does
      // not reliably repaint when JS mutates the meta later, so the dark
      // toolbar color must be selectable at first paint via a media query.
      settings.skinName = 'colibris';
      settings.skinVariants = 'super-light-toolbar super-light-editor light-background';
      settings.enableDarkMode = true;
      const res = await agent.get('/p/testpad').expect(200);
      assert.match(res.text,
        /<meta name="theme-color" content="#ffffff" media="\(prefers-color-scheme: light\)">/);
      assert.match(res.text,
        /<meta name="theme-color" content="#485365" media="\(prefers-color-scheme: dark\)">/);
    });

    it('pad page omits the dark variant when enableDarkMode is off', async function () {
      // With dark mode disabled the client never auto-switches, so the address
      // bar should stay on the unscoped light baseline.
      settings.skinName = 'colibris';
      settings.skinVariants = 'super-light-toolbar super-light-editor light-background';
      settings.enableDarkMode = false;
      const res = await agent.get('/p/testpad').expect(200);
      assert.match(res.text, /<meta name="theme-color" content="#ffffff">/);
      assert.doesNotMatch(res.text, /prefers-color-scheme/);
    });

    it('pad page tracks an explicit dark toolbar variant', async function () {
      settings.skinName = 'colibris';
      settings.skinVariants = 'dark-toolbar dark-editor dark-background';
      const res = await agent.get('/p/testpad').expect(200);
      assert.match(res.text, /<meta name="theme-color" content="#576273"/);
    });

    it('pad page omits theme-color for non-colibris skins', async function () {
      settings.skinName = 'no-skin';
      settings.skinVariants = 'super-light-toolbar';
      const res = await agent.get('/p/testpad').expect(200);
      assert.doesNotMatch(res.text, /theme-color/);
    });

    it('timeslider page emits a light baseline and a media-scoped dark variant', async function () {
      settings.skinName = 'colibris';
      settings.skinVariants = 'super-light-toolbar super-light-editor light-background';
      settings.enableDarkMode = true;
      // Issue #7659: /p/:pad/timeslider redirects unless ?embed=1 — that
      // query is the iframe path that still serves the timeslider HTML.
      const res = await agent.get('/p/testpad/timeslider?embed=1').expect(200);
      assert.match(res.text,
        /<meta name="theme-color" content="#ffffff" media="\(prefers-color-scheme: light\)">/);
      assert.match(res.text,
        /<meta name="theme-color" content="#485365" media="\(prefers-color-scheme: dark\)">/);
    });

    it('timeslider page omits theme-color for non-colibris skins', async function () {
      settings.skinName = 'no-skin';
      settings.skinVariants = 'super-light-toolbar';
      const res = await agent.get('/p/testpad/timeslider?embed=1').expect(200);
      assert.doesNotMatch(res.text, /theme-color/);
    });
  });

  describe('dark-mode flash prevention', function () {
    const backups:MapArrayType<any> = {};
    beforeEach(function () {
      backups.skinName = settings.skinName;
      backups.enableDarkMode = settings.enableDarkMode;
    });
    afterEach(function () {
      settings.skinName = backups.skinName;
      settings.enableDarkMode = backups.enableDarkMode;
    });

    const PREPAINT = "classList.add('super-dark-editor', 'dark-background', 'super-dark-toolbar')";

    it('pad page inlines the pre-paint dark-mode script before the stylesheet', async function () {
      // Issue #7606: without this, dark-OS users see the page painted light
      // until the JS bundle runs and flips the skin classes. The inline script
      // must come before pad.css so the dark classes are on <html> at first
      // paint.
      settings.skinName = 'colibris';
      settings.enableDarkMode = true;
      const res = await agent.get('/p/testpad').expect(200);
      const scriptIdx = res.text.indexOf(PREPAINT);
      const cssIdx = res.text.indexOf('css/pad.css');
      assert(scriptIdx !== -1, 'expected the pre-paint dark-mode script in the pad page');
      assert(cssIdx !== -1 && scriptIdx < cssIdx,
        'pre-paint dark-mode script must come before pad.css so it applies before first paint');
      // Must skip the auto-dark switch on the skin-variants builder, matching
      // pad.ts (so it can't fight the builder UI on a dark-OS client).
      assert(res.text.includes('#skinvariantsbuilder'),
        'pre-paint script must guard against the #skinvariantsbuilder hash like pad.ts');
    });

    it('timeslider page inlines the pre-paint dark-mode script', async function () {
      settings.skinName = 'colibris';
      settings.enableDarkMode = true;
      const res = await agent.get('/p/testpad/timeslider?embed=1').expect(200);
      assert(res.text.includes(PREPAINT),
        'expected the pre-paint dark-mode script in the timeslider page');
    });

    it('omits the pre-paint script when dark mode is disabled', async function () {
      settings.skinName = 'colibris';
      settings.enableDarkMode = false;
      const res = await agent.get('/p/testpad').expect(200);
      assert(!res.text.includes(PREPAINT));
    });

    it('omits the pre-paint script for non-colibris skins', async function () {
      settings.skinName = 'no-skin';
      settings.enableDarkMode = true;
      const res = await agent.get('/p/testpad').expect(200);
      assert(!res.text.includes(PREPAINT));
    });
  });
});
