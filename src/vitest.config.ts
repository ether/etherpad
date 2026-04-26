import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/backend/vitest.setup.ts'],
    include: [
      'tests/backend-new/specs/**/*.ts',
      'tests/backend/specs/**/*.ts',
      'tests/container/specs/**/*.ts',
    ],
    hookTimeout: 60000,
    testTimeout: 120000,
  },
});
