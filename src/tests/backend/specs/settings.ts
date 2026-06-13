'use strict';

const assert = require('assert').strict;
import {exportedForTestingOnly} from '../../../node/utils/Settings'
import path from 'path';
import process from 'process';

describe(__filename, function () {
  describe('parseSettings', function () {
    let settings: any;
    const envVarSubstTestCases = [
      {name: 'true', val: 'true', var: 'SET_VAR_TRUE', want: true},
      {name: 'false', val: 'false', var: 'SET_VAR_FALSE', want: false},
      {name: 'null', val: 'null', var: 'SET_VAR_NULL', want: null},
      {name: 'undefined', val: 'undefined', var: 'SET_VAR_UNDEFINED', want: undefined},
      {name: 'number', val: '123', var: 'SET_VAR_NUMBER', want: 123},
      {name: 'string', val: 'foo', var: 'SET_VAR_STRING', want: 'foo'},
      {name: 'empty string', val: '', var: 'SET_VAR_EMPTY_STRING', want: ''},
    ];

    before(async function () {
      for (const tc of envVarSubstTestCases) process.env[tc.var] = tc.val;
      delete process.env.UNSET_VAR;
      settings = exportedForTestingOnly.parseSettings(path.join(__dirname, 'settings.json'), true);
      assert(settings != null);
    });

    describe('environment variable substitution', function () {
      describe('set', function () {
        for (const tc of envVarSubstTestCases) {
          it(tc.name, async function () {
            const obj = settings['environment variable substitution'].set;
            if (tc.name === 'undefined') {
              assert(!(tc.name in obj));
            } else {
              assert.equal(obj[tc.name], tc.want);
            }
          });
        }
      });

      describe('unset', function () {
        it('no default', async function () {
          const obj = settings['environment variable substitution'].unset;
          assert.equal(obj['no default'], null);
        });

        for (const tc of envVarSubstTestCases) {
          it(tc.name, async function () {
            const obj = settings['environment variable substitution'].unset;
            if (tc.name === 'undefined') {
              assert(!(tc.name in obj));
            } else {
              assert.equal(obj[tc.name], tc.want);
            }
          });
        }
      });
    });
  });


  describe("Parse plugin settings", function () {

    before(async function () {
      process.env["EP__ADMIN__PASSWORD"] = "test"
    })

    it('should parse plugin settings', async function () {
      let settings = exportedForTestingOnly.parseSettings(path.join(__dirname, 'settings.json'), true);
      assert.equal(settings!.ADMIN.PASSWORD, "test");
    })

    it('should bundle settings with same path', async function () {
      process.env["EP__ADMIN__USERNAME"] = "test"
      let settings = exportedForTestingOnly.parseSettings(path.join(__dirname, 'settings.json'), true);
      assert.deepEqual(settings!.ADMIN, {PASSWORD: "test", USERNAME: "test"});
    })

    it("Can set the ep themes", async function () {
      process.env["EP__ep_themes__default_theme"] = "hacker"
      let settings = exportedForTestingOnly.parseSettings(path.join(__dirname, 'settings.json'), true);
      assert.deepEqual(settings!.ep_themes, {"default_theme": "hacker"});
    })

    it("can set the ep_webrtc settings", async function () {
      process.env["EP__ep_webrtc__enabled"] = "true"
      let settings = exportedForTestingOnly.parseSettings(path.join(__dirname, 'settings.json'), true);
      assert.deepEqual(settings!.ep_webrtc, {"enabled": true});
    })
  })

  // Regression test for https://github.com/ether/etherpad/issues/7543.
  // Plugins (ep_font_color, ep_font_size, ep_plugin_helpers, …) consume
  // Settings via CommonJS require(), which under tsx/ESM interop would place
  // the default export under .default and leave top-level fields undefined.
  // That broke template rendering with:
  //   TypeError: Cannot read properties of undefined (reading 'indexOf')
  // when plugins called settings.toolbar.left / etc.
  //
  // The CJS compat layer in Settings.ts re-exposes every top-level field on
  // module.exports via accessor properties, so require(...).<field> resolves
  // even though the source uses `export default`. This test asserts that
  // contract so a future refactor can't regress it silently.
  describe('CJS compatibility for plugin consumers', function () {
    it('exposes top-level fields directly on require() result', function () {
      const cjs = require('../../../node/utils/Settings');
      // The three fields most commonly read by first-party plugins.
      assert.notStrictEqual(cjs.toolbar, undefined,
          'settings.toolbar must be reachable via CJS require');
      assert.notStrictEqual(cjs.skinName, undefined,
          'settings.skinName must be reachable via CJS require');
      assert.notStrictEqual(cjs.padOptions, undefined,
          'settings.padOptions must be reachable via CJS require');
    });

    it('toolbar has the shape plugins index into (left/right/timeslider)', function () {
      const cjs = require('../../../node/utils/Settings');
      // ep_font_color and friends JSON.stringify(settings.toolbar) then call
      // .indexOf on the result, so the object must be present and well-formed.
      assert.ok(cjs.toolbar && typeof cjs.toolbar === 'object');
      assert.ok(Array.isArray(cjs.toolbar.left));
      assert.ok(Array.isArray(cjs.toolbar.right));
      assert.ok(Array.isArray(cjs.toolbar.timeslider));
    });

    it('does not hide the real value under a .default wrapper', function () {
      const cjs = require('../../../node/utils/Settings');
      // If export-default handling regresses, consumers end up seeing a
      // {default: {...}} wrapper and .toolbar on the wrapper is undefined.
      // Either shape is acceptable as long as .toolbar is directly present,
      // which is what the CJS compat shim guarantees.
      if (cjs.default != null && cjs.default.toolbar != null) {
        assert.strictEqual(cjs.toolbar, cjs.default.toolbar,
            'require().toolbar must be the same object as require().default.toolbar');
      }
    });

    it('setters propagate so reloadSettings() changes are visible to plugins', function () {
      const cjs = require('../../../node/utils/Settings');
      const original = cjs.title;
      try {
        cjs.title = 'cjs-shim-test';
        assert.strictEqual(cjs.title, 'cjs-shim-test');
      } finally {
        cjs.title = original;
      }
    });
  });

  // Regression test for https://github.com/ether/etherpad/issues/7213.
  // Pre-fix: randomVersionString was `randomString(4)`, regenerated on every
  // boot — the padbootstrap-<hash>.min.js filename therefore differed across
  // pods of the same build, producing 404s on any cross-pod request in a
  // horizontally-scaled deployment. Post-fix: the token is a deterministic
  // hash of version + gitVersion (or an explicit
  // ETHERPAD_VERSION_STRING env var).
  describe('randomVersionString determinism (issue #7213)', function () {
    it('is a stable 8-hex-char sha256 prefix by default', function () {
      const settings = require('../../../node/utils/Settings');
      assert.match(settings.randomVersionString, /^[0-9a-f]{8}$/,
          `expected 8-char hex, got ${settings.randomVersionString}`);
    });

    it('honours ETHERPAD_VERSION_STRING as an explicit override', function () {
      const settingsMod = require('../../../node/utils/Settings');
      const original = process.env.ETHERPAD_VERSION_STRING;
      const savedSettingsFile = settingsMod.settingsFilename;
      const savedCredsFile = settingsMod.credentialsFilename;
      const savedToken = settingsMod.randomVersionString;
      process.env.ETHERPAD_VERSION_STRING = 'integrator-1';
      settingsMod.settingsFilename = path.join(__dirname, 'settings.json');
      settingsMod.credentialsFilename = path.join(__dirname, 'credentials.json');
      try {
        // The token is set by reloadSettings, not by parseSettings alone.
        // Re-run the full reload path so the env var is consulted.
        settingsMod.reloadSettings();
        assert.strictEqual(settingsMod.randomVersionString, 'integrator-1',
            'ETHERPAD_VERSION_STRING should be used verbatim');
      } finally {
        if (original == null) delete process.env.ETHERPAD_VERSION_STRING;
        else process.env.ETHERPAD_VERSION_STRING = original;
        settingsMod.settingsFilename = savedSettingsFile;
        settingsMod.credentialsFilename = savedCredsFile;
        settingsMod.randomVersionString = savedToken;
      }
    });
  });

  // Regression test for ether/etherpad#7138.
  // padOptions.fadeInactiveAuthorColors must default to true so existing
  // installations keep the legacy fade-on-inactive behavior, and must be
  // overridable via PAD_OPTIONS_FADE_INACTIVE_AUTHOR_COLORS in docker.
  describe('padOptions.fadeInactiveAuthorColors (issue #7138)', function () {
    it('defaults to true so existing deployments are unchanged', function () {
      const settings = require('../../../node/utils/Settings');
      assert.strictEqual(settings.padOptions.fadeInactiveAuthorColors, true);
    });
  });

  // Regression test for ether/etherpad#7911.
  // Air-gapped / firewalled deployments must be able to disable Etherpad's
  // outbound calls (version check + plugin catalogue + self-updater) purely
  // via environment variables, without editing settings.json inside the image.
  // These assertions parse the *shipped* settings.json.docker so a future edit
  // that drops the ${ENV} placeholders fails loudly here.
  describe('offline / air-gapped env overrides (issue #7911)', function () {
    const dockerSettings = path.join(__dirname, '../../../../settings.json.docker');
    const templateSettings = path.join(__dirname, '../../../../settings.json.template');
    const envVars = [
      'PRIVACY_UPDATE_CHECK', 'PRIVACY_PLUGIN_CATALOG', 'UPDATES_TIER',
      'UPDATES_SOURCE', 'UPDATES_CHANNEL', 'UPDATES_CHECK_INTERVAL_HOURS',
      'UPDATES_GITHUB_REPO', 'UPDATES_REQUIRE_ADMIN_FOR_STATUS', 'UPDATE_SERVER',
    ];
    const saved: {[k: string]: string | undefined} = {};

    before(function () { for (const v of envVars) saved[v] = process.env[v]; });
    afterEach(function () {
      for (const v of envVars) {
        if (saved[v] == null) delete process.env[v];
        else process.env[v] = saved[v];
      }
    });

    it('keeps shipped defaults when no env vars are set', function () {
      for (const v of envVars) delete process.env[v];
      const s = exportedForTestingOnly.parseSettings(dockerSettings, true);
      assert.strictEqual(s!.privacy.updateCheck, true);
      assert.strictEqual(s!.privacy.pluginCatalog, true);
      assert.strictEqual(s!.updates.tier, 'notify');
      assert.strictEqual(s!.updates.checkIntervalHours, 6);
      assert.strictEqual(s!.updateServer, 'https://etherpad.org/ep_infos');
    });

    it('disables all outbound calls when the offline env vars are set', function () {
      process.env.PRIVACY_UPDATE_CHECK = 'false';
      process.env.PRIVACY_PLUGIN_CATALOG = 'false';
      process.env.UPDATES_TIER = 'off';
      const s = exportedForTestingOnly.parseSettings(dockerSettings, true);
      // Coerced to real booleans, not the strings "false".
      assert.strictEqual(s!.privacy.updateCheck, false);
      assert.strictEqual(s!.privacy.pluginCatalog, false);
      assert.strictEqual(s!.updates.tier, 'off');
    });

    it('honours the remaining updates.* and updateServer overrides', function () {
      process.env.UPDATES_SOURCE = 'gitlab';
      process.env.UPDATES_CHANNEL = 'beta';
      process.env.UPDATES_CHECK_INTERVAL_HOURS = '24';
      process.env.UPDATES_GITHUB_REPO = 'acme/etherpad-fork';
      process.env.UPDATES_REQUIRE_ADMIN_FOR_STATUS = 'true';
      process.env.UPDATE_SERVER = 'https://mirror.internal/ep_infos';
      const s = exportedForTestingOnly.parseSettings(dockerSettings, true);
      assert.strictEqual(s!.updates.source, 'gitlab');
      assert.strictEqual(s!.updates.channel, 'beta');
      assert.strictEqual(s!.updates.checkIntervalHours, 24); // numeric coercion
      assert.strictEqual(s!.updates.githubRepo, 'acme/etherpad-fork');
      assert.strictEqual(s!.updates.requireAdminForStatus, true); // boolean coercion
      assert.strictEqual(s!.updateServer, 'https://mirror.internal/ep_infos');
    });

    // The source-install template carries the same placeholders so non-Docker
    // deployments get the offline knobs too.
    it('settings.json.template exposes the same offline overrides', function () {
      for (const v of envVars) delete process.env[v];
      const dflt = exportedForTestingOnly.parseSettings(templateSettings, true);
      assert.strictEqual(dflt!.privacy.updateCheck, true);
      assert.strictEqual(dflt!.privacy.pluginCatalog, true);
      assert.strictEqual(dflt!.updates.tier, 'notify');
      assert.strictEqual(dflt!.updateServer, 'https://etherpad.org/ep_infos');

      process.env.UPDATES_TIER = 'off';
      process.env.PRIVACY_UPDATE_CHECK = 'false';
      process.env.PRIVACY_PLUGIN_CATALOG = 'false';
      const over = exportedForTestingOnly.parseSettings(templateSettings, true);
      assert.strictEqual(over!.updates.tier, 'off');
      assert.strictEqual(over!.privacy.updateCheck, false);
      assert.strictEqual(over!.privacy.pluginCatalog, false);
    });
  });
});
