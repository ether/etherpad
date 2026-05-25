'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import assert from 'assert';
import settings, {exportedForTestingOnly} from '../../../node/utils/Settings.js'
import * as settingsMod from '../../../node/utils/Settings.js'
import path from 'path';
import process from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

  // The previous "CJS compatibility for plugin consumers" describe block was
  // removed when Settings.ts was migrated to ESM. The legacy contract
  // (`require('Settings').toolbar` returning the field directly) was a side
  // effect of `module.exports` accessor properties that no longer exists in
  // ESM. Plugins must now use either `import settings from '...'` (recommended)
  // or `require('Settings').default.toolbar` via the createRequire bridge.
  // See doc/plugins.md for the new ESM/CJS plugin contract.

  // Regression test for https://github.com/ether/etherpad/issues/7213.
  // Pre-fix: randomVersionString was `randomString(4)`, regenerated on every
  // boot — the padbootstrap-<hash>.min.js filename therefore differed across
  // pods of the same build, producing 404s on any cross-pod request in a
  // horizontally-scaled deployment. Post-fix: the token is a deterministic
  // hash of version + gitVersion (or an explicit
  // ETHERPAD_VERSION_STRING env var).
  describe('randomVersionString determinism (issue #7213)', function () {
    it('is a stable 8-hex-char sha256 prefix by default', function () {
      assert.match(settings.randomVersionString, /^[0-9a-f]{8}$/,
          `expected 8-char hex, got ${settings.randomVersionString}`);
    });

    it('honours ETHERPAD_VERSION_STRING as an explicit override', function () {
      const original = process.env.ETHERPAD_VERSION_STRING;
      const savedSettingsFile = (settingsMod as any).settingsFilename;
      const savedCredsFile = (settingsMod as any).credentialsFilename;
      const savedToken = settings.randomVersionString;
      process.env.ETHERPAD_VERSION_STRING = 'integrator-1';
      (settingsMod as any).settingsFilename = path.join(__dirname, 'settings.json');
      (settingsMod as any).credentialsFilename = path.join(__dirname, 'credentials.json');
      try {
        // The token is set by reloadSettings, not by parseSettings alone.
        // Re-run the full reload path so the env var is consulted.
        (settingsMod as any).reloadSettings();
        assert.strictEqual(settings.randomVersionString, 'integrator-1',
            'ETHERPAD_VERSION_STRING should be used verbatim');
      } finally {
        if (original == null) delete process.env.ETHERPAD_VERSION_STRING;
        else process.env.ETHERPAD_VERSION_STRING = original;
        (settingsMod as any).settingsFilename = savedSettingsFile;
        (settingsMod as any).credentialsFilename = savedCredsFile;
        settings.randomVersionString = savedToken;
      }
    });
  });

  // Regression test for ether/etherpad#7138.
  // padOptions.fadeInactiveAuthorColors must default to true so existing
  // installations keep the legacy fade-on-inactive behavior, and must be
  // overridable via PAD_OPTIONS_FADE_INACTIVE_AUTHOR_COLORS in docker.
  describe('padOptions.fadeInactiveAuthorColors (issue #7138)', function () {
    it('defaults to true so existing deployments are unchanged', function () {
      assert.strictEqual(settings.padOptions.fadeInactiveAuthorColors, true);
    });
  });
});
