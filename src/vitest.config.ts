import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';

const srcRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Self-imports: route ep_etherpad-lite/<subpath>(.js)? → src/<subpath>.ts so we
      // exercise the actual sources, not the dist/ twins. Plugins (outside src/)
      // still hit the package.json exports map at runtime.
      { find: /^ep_etherpad-lite\/(.+?)(?:\.js)?$/, replacement: `${srcRoot}$1.ts` },
    ],
  },
  test: {
    globals: true,
    setupFiles: ['./tests/backend/vitest.setup.ts'],
    include: [
      'tests/backend-new/specs/**/*.ts',
      'tests/backend/specs/**/*.ts',
    ],
    // Container tests (tests/container/specs/**/*.ts) are excluded from
    // the default include because they target a separately-booted Etherpad
    // process (the docker image, port 9001) and ECONNREFUSED locally. They
    // are invoked explicitly by the `test-container` script which passes
    // its own include via --include.
    hookTimeout: 60000,
    testTimeout: 120000,
    // Backend tests share a single Etherpad server instance + rustydb file.
    // Vitest's default parallel/isolated workers each boot their own server
    // and crash the second-to-open with `Error: DatabaseAlreadyOpen`. Mocha
    // never hit this because everything ran in one process. Force one fork,
    // sequential file execution, no per-file isolation — same effective
    // model as the old mocha runner.
    pool: 'forks',
    fileParallelism: false,
    isolate: false,
  },
});
