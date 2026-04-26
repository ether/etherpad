'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import assert from 'assert';
import {exportedForTestingOnly} from '../../../node/utils/Settings.js'
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
});
