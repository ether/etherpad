// admin/src/api/__tests__/client.test.ts
//
// Smoke test that the OpenAPI client module loads and exposes the expected
// surface. Catches toolchain wiring regressions (missing peer deps,
// generator output that doesn't export `paths`, etc.).

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('client module exports fetchClient and $api', async () => {
  const mod = await import('../client.ts');
  assert.ok(mod.fetchClient, 'fetchClient export is present');
  assert.ok(mod.$api, '$api export is present');
  assert.equal(typeof mod.fetchClient.GET, 'function', 'fetchClient.GET is a function');
  assert.equal(typeof mod.$api.useQuery, 'function', '$api.useQuery is a function');
});
