import { writeFileSync } from 'node:fs';
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
    hooks: {
      // Node's legacy trailing-slash exports mapping for "./node/eejs/" resolves
      // the empty suffix to dist/node/eejs/.mjs (key + "" → value-prefix + "").
      // We emit this stub so require('ep_etherpad-lite/node/eejs/') works even
      // though DEP0155 will still fire for callers using the trailing-slash form.
      'build:done': () => {
        writeFileSync('dist/node/eejs/.mjs', "export * from './index.mjs';\n");
      },
    },
  },
  {
    ...common,
    entry: cjsEntries,
    format: 'cjs',
    outDir: 'dist-cjs',
    hooks: {
      // Counterpart CJS stub for the "./node/eejs/" trailing-slash exports entry.
      'build:done': () => {
        writeFileSync('dist-cjs/node/eejs/.cjs', "module.exports = require('./index.cjs');\n");
      },
    },
  },
]);
