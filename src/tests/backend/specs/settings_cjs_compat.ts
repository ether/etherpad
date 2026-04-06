'use strict';

import {describe, it} from 'mocha';
import assert from 'assert';

describe('Settings CJS compatibility', function () {
  it('CJS require can read settings properties directly', async function () {
    // Simulate CJS require - the module.exports compatibility layer should
    // expose settings properties directly (not under .default)
    const settings = require('ep_etherpad-lite/node/utils/Settings');
    assert(settings.root != null, 'settings.root should be accessible');
    assert(typeof settings.port === 'number', 'settings.port should be a number');
  });

  it('CJS require can write settings properties', async function () {
    // Regression test: the CJS compatibility layer must have setters,
    // not just getters, so plugins can mutate settings (e.g. in tests).
    const settings = require('ep_etherpad-lite/node/utils/Settings');
    const original = settings.requireAuthentication;
    try {
      settings.requireAuthentication = !original;
      assert.strictEqual(settings.requireAuthentication, !original,
          'setting should be writable via CJS require');
    } finally {
      settings.requireAuthentication = original;
    }
  });

  it('CJS writes are visible through ESM default import', async function () {
    const settingsCjs = require('ep_etherpad-lite/node/utils/Settings');
    const {default: settingsEsm} = await import('ep_etherpad-lite/node/utils/Settings');
    const original = settingsCjs.title;
    try {
      settingsCjs.title = 'CJS_TEST_VALUE';
      assert.strictEqual(settingsEsm.title, 'CJS_TEST_VALUE',
          'CJS setter should update the same underlying object as ESM import');
    } finally {
      settingsCjs.title = original;
    }
  });
});
