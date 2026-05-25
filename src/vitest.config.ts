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
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          globals: true,
          setupFiles: ['./tests/backend/vitest.setup.ts'],
          include: ['tests/backend-new/specs/**/*.ts'],
          hookTimeout: 60000,
          testTimeout: 60000,
          // Unit tests use vi.mock heavily — they NEED isolation. Each
          // file gets a fresh module graph so mocks declared at the top
          // of the file actually apply.
          isolate: true,
          fileParallelism: true,
          pool: 'forks',
          sequence: {
            // Run unit project first (group 1), then integration (group 2).
            // Different groupOrder is required when projects have different maxWorkers.
            groupOrder: 1,
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          globals: true,
          setupFiles: ['./tests/backend/vitest.setup.ts'],
          include: ['tests/backend/specs/**/*.ts'],
          hookTimeout: 60000,
          testTimeout: 120000,
          // Backend tests share a single Etherpad server instance + rustydb file.
          // Vitest's default parallel/isolated workers each boot their own server
          // and crash the second-to-open with `Error: DatabaseAlreadyOpen`. Force
          // one fork, sequential file execution, no per-file isolation — same
          // effective model as the old mocha runner.
          pool: 'forks',
          fileParallelism: false,
          isolate: false,
          sequence: {
            // Run after the unit project (group 2 runs after group 1).
            groupOrder: 2,
          },
        },
      },
    ],
  },
});
