import { defineConfig } from 'tsdown';

// Globs covering every subpath plugins consume from ep_etherpad-lite.
// Specs and fixtures are excluded via negation patterns.
const commonEntries = [
  'node/**/*.ts',
  'static/js/**/*.ts',
  'tests/backend/**/*.ts',
  '!**/*.d.ts',
  '!tests/backend/fixtures/**',
  '!tests/backend/specs/**',
];

// The CJS twin excludes server.ts (top-level await) and the test helpers
// (common.ts transitively imports server.ts). CJS consumers of
// ep_etherpad-lite only need the library surface; test helpers are ESM-only.
//
// node/db/**/*.ts and node/utils/ImportEtherpad.ts are also excluded from CJS
// because they transitively import ueberdb2, which is ESM-only (no "require"
// export condition in its package.json). Plugins that need db access must use
// ESM `await import('ep_etherpad-lite/node/db/...')`.
const cjsEntries = [
  'node/**/*.ts',
  'static/js/**/*.ts',
  '!**/*.d.ts',
  '!node/server.ts',
  '!node/db/**/*.ts',
  '!node/utils/ImportEtherpad.ts',
];

const common = {
  unbundle: true as const,
  dts: false as const,
  target: 'node24' as const,
};

export default defineConfig([
  {
    ...common,
    entry: commonEntries,
    format: 'esm',
    outDir: 'dist',
  },
  {
    ...common,
    entry: cjsEntries,
    format: 'cjs',
    outDir: 'dist-cjs',
  },
]);
