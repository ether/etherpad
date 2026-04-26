'use strict';

const assert = require('assert').strict;
const common = require('../common');

// Regression coverage for https://github.com/ether/etherpad/issues/7586
//
// The admin React SPA fetches its translations from
// `${BASE_URL}/locales/<lang>.json` (where BASE_URL is `/admin/`). When the
// locale files are missing from the build output, the express admin handler
// falls back to serving `index.html` (the SPA router fallback) — the loader
// then receives HTML, JSON.parse fails silently, and i18next renders raw keys
// instead of translations. These tests pin the behaviour so a build/copy
// regression cannot ship again unnoticed.
describe(__filename, function () {
  let agent: any;

  before(async function () {
    agent = await common.init();
  });

  it('serves /admin/locales/en.json as JSON with translations', async function () {
    const res = await agent.get('/admin/locales/en.json').expect(200);
    assert.match(res.headers['content-type'] || '', /application\/json/i,
        `expected JSON content-type, got: ${res.headers['content-type']}`);
    assert.equal(typeof res.body, 'object');
    assert.equal(res.body['admin_plugins'], 'Plugin manager');
  });

  it('serves /admin/locales/de.json as JSON with German translations', async function () {
    const res = await agent.get('/admin/locales/de.json').expect(200);
    assert.match(res.headers['content-type'] || '', /application\/json/i,
        `expected JSON content-type, got: ${res.headers['content-type']}`);
    assert.equal(typeof res.body, 'object');
    assert.equal(res.body['admin_plugins'], 'Pluginverwaltung');
  });
});
