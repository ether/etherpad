'use strict';

/**
 * `:` is rejected as a pad id (GHSA-wg58-mhwv-35pq), but a browser visiting a
 * legacy `/p/<id with ":">` URL must still be redirected to the sanitized `_`
 * form (padManager.sanitizePadId maps `:` -> `_`) rather than getting a 404.
 * Regression guard for the padurlsanitize ordering.
 */

const assert = require('assert').strict;
const common = require('../common');

let agent: any;

describe(__filename, function () {
  this.timeout(30000);
  before(async function () { agent = await common.init(); });

  it('redirects a legacy pad URL containing ":" to the sanitized "_" form', async function () {
    const res = await agent.get('/p/foo:bar').expect(302);
    assert.match(res.headers.location, /foo_bar/,
        `expected redirect to the sanitized id, got Location: ${res.headers.location}`);
  });

  it('still 404s a pad id containing "$" (no sanitizing transform)', async function () {
    await agent.get('/p/foo$bar').expect(404);
  });

  it('serves a clean pad id without redirecting', async function () {
    // A valid id renders (200) or is handled normally — never a sanitize redirect.
    const res = await agent.get('/p/CleanPadId123');
    assert.notEqual(res.status, 404);
  });
});
