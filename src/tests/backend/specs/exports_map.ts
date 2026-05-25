import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// CJS subpaths that must resolve to a .cjs file (have a "require" condition).
// Note: node/db/* is intentionally excluded — those modules import ueberdb2
// which is ESM-only, so their exports entry has only an "import" condition.
const cjsResolvableSubpaths = [
  'ep_etherpad-lite/node/eejs',
  'ep_etherpad-lite/static/js/pad_utils',
];

// Only these subpaths can be synchronously require()-loaded: their transitive
// dependency graph is CJS-compatible. DB modules (PadManager, API, AuthorManager)
// transitively import ueberdb2 which is ESM-only (no "require" export condition).
const cjsLoadableSubpaths = [
  'ep_etherpad-lite/node/eejs',
  'ep_etherpad-lite/static/js/pad_utils',
];

// These subpaths are ESM-only (no "require" condition). Trying to
// require.resolve() them should throw.
const esmOnlySubpaths = [
  'ep_etherpad-lite/node/db/PadManager',
  'ep_etherpad-lite/node/db/API.js',
  'ep_etherpad-lite/node/db/AuthorManager',
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

  describe('ESM-only subpaths (no require condition)', () => {
    for (const spec of esmOnlySubpaths) {
      test(`require.resolve('${spec}') throws (no "require" condition)`, () => {
        expect(() => require.resolve(spec)).toThrow();
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
