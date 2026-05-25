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
// node/db/** and node/utils/ImportEtherpad.ts USED to be excluded because they
// imported ueberdb2 (ESM-only, no "require" export condition) at the top of
// the file, which crashed when a CJS plugin require()'d them. Those imports
// were converted to lazy `await import('ueberdb2')` inside init(), so the CJS
// twin now compiles without a top-level ueberdb2 require — safe to ship.
const cjsEntries = [
  'node/**/*.ts',
  'static/js/**/*.ts',
  '!**/*.d.ts',
  '!node/server.ts',
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
