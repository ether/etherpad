import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// CJS subpaths that must resolve to a .cjs file (have a "require" condition).
// node/db/* is included now that DB.ts uses a lazy `await import('ueberdb2')`
// instead of a top-level import: the CJS twin no longer requires ueberdb2 at
// load time, so it can be require()-d safely from CJS plugin code.
const cjsResolvableSubpaths = [
  'ep_etherpad-lite/node/eejs',
  'ep_etherpad-lite/static/js/pad_utils',
  'ep_etherpad-lite/node/db/PadManager',
  'ep_etherpad-lite/node/db/AuthorManager',
];

// These subpaths can be synchronously require()-loaded: their transitive
// dependency graph is CJS-compatible. We don't include the db modules here
// because LOADING them is fine, but they only become usable after etherpad's
// init() has run — exercised by the integration tests elsewhere, not here.
const cjsLoadableSubpaths = [
  'ep_etherpad-lite/node/eejs',
  'ep_etherpad-lite/static/js/pad_utils',
  'ep_etherpad-lite/node/db/PadManager',
];

const esmSubpaths = [
  'ep_etherpad-lite/node/eejs/index.js',
  'ep_etherpad-lite/node/db/PadManager.js',
  'ep_etherpad-lite/node/db/API.js',
  'ep_etherpad-lite/static/js/pad_utils.js',
];

describe('ep_etherpad-lite exports map', () => {
  describe('require() condition (CJS plugins)', () => {
    for (const spec of cjsResolvableSubpaths) {
      test(`require('${spec}') resolves`, () => {
        const resolved = require.resolve(spec);
        expect(resolved).toMatch(/\.cjs$/);
      });
    }

    for (const spec of cjsLoadableSubpaths) {
      test(`require('${spec}') loads a module`, () => {
        const mod = require(spec);
        expect(mod).toBeTruthy();
        expect(typeof mod).toBe('object');
      });
    }
  });

  describe('import() condition (ESM plugins)', () => {
    for (const spec of esmSubpaths) {
      test(`import('${spec}') resolves to a .js file`, async () => {
        const mod = await import(spec);
        expect(mod).toBeTruthy();
      });
    }
  });
});
