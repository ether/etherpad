import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const cjsSubpaths = [
  'ep_etherpad-lite/node/eejs',
  'ep_etherpad-lite/node/db/PadManager',
  'ep_etherpad-lite/node/db/API.js',
  'ep_etherpad-lite/node/db/AuthorManager',
  'ep_etherpad-lite/static/js/pad_utils',
  'ep_etherpad-lite/tests/backend/common',
];

const esmSubpaths = [
  'ep_etherpad-lite/node/eejs/index.js',
  'ep_etherpad-lite/node/db/PadManager.js',
  'ep_etherpad-lite/node/db/API.js',
  'ep_etherpad-lite/static/js/pad_utils.js',
];

describe('ep_etherpad-lite exports map', () => {
  describe('require() condition (CJS plugins)', () => {
    for (const spec of cjsSubpaths) {
      test(`require('${spec}') resolves`, () => {
        const resolved = require.resolve(spec);
        expect(resolved).toMatch(/\.cjs$/);
      });

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
