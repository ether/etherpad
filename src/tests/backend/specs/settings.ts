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
});
