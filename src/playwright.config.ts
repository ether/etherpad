import {defineConfig, devices, test} from '@playwright/test';


export const defaultExpectTimeout = process.env.CI ? 20 * 1000 : 5000
export const defaultTestTimeout = 90 * 1000

// Mirror of how tests/backend/specs picks up plugin specs from
// `../node_modules/ep_*/static/tests/backend/specs/**`. Plugins that
// ship Playwright frontend tests at the conventional location below
// are discovered automatically when the plugin is installed alongside
// core. See doc/PLUGIN_FRONTEND_TESTS.md.
const CORE_SPECS = 'tests/frontend-new/specs/**/*.spec.ts';
const ADMIN_SPECS = 'tests/frontend-new/admin-spec/**/*.spec.ts';
const PLUGIN_SPECS = [
  // Plugins installed via `pnpm add -w ep_*` (CI / dev workspace).
  '../node_modules/ep_*/static/tests/frontend-new/specs/**/*.spec.ts',
  // Plugins installed via the admin UI / live-plugin-manager land
  // here instead of node_modules.
  'plugin_packages/ep_*/static/tests/frontend-new/specs/**/*.spec.ts',
];
const FRONTEND_MATCH = [CORE_SPECS, ...PLUGIN_SPECS];

// Vendored plugin specs we can't edit that are flaky under the WITH_PLUGINS
// firefox run (keystrokes drop when the /ether plugin set is loaded). Skip
// only when WITH_PLUGINS=1 so the standalone plugin runs still cover them.
// Tracking issue: #7611. Mirror of the `test.skip(WITH_PLUGINS)` pattern
// used in our own core specs.
const FRONTEND_IGNORE = process.env.WITH_PLUGINS === '1' ? [
  '**/ep_headings2*/static/tests/frontend-new/specs/headings.spec.ts',
] : [];

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  // testDir is project-root for src/ so the testMatch globs reach both
  // tests under src/tests/... and node_modules/ep_*/... above src/.
  testDir: '.',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI ? [['github'], ['list']] : 'html',
  expect: { timeout: defaultExpectTimeout },
  timeout: defaultTestTimeout,
  // Plugin-loaded suites are inherently flakier (slower pad boot,
  // extra hooks racing) so give them a bigger retry cushion. Strict
  // equality on '1' so WITH_PLUGINS=0 doesn't accidentally enable the
  // with-plugins behaviour (any non-empty string is truthy in JS).
  retries: process.env.CI ? (process.env.WITH_PLUGINS === '1' ? 5 : 2) : 0,
  workers: 2,
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://127.0.0.1:3000',
    baseURL: "localhost:9001",
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    // Frontend / pad-editor specs (core + plugins).
    {
      name: 'chromium',
      testMatch: FRONTEND_MATCH,
      testIgnore: FRONTEND_IGNORE,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testMatch: FRONTEND_MATCH,
      testIgnore: FRONTEND_IGNORE,
      use: { ...devices['Desktop Firefox'] },
    },

    // Admin-UI specs are isolated from the regular frontend run so the
    // existing test-admin script + frontend-admin-tests workflow keep
    // their own scope (different fixtures, different server state).
    {
      name: 'chromium-admin',
      testMatch: ADMIN_SPECS,
      use: { ...devices['Desktop Chrome'] },
    },
    // Webkit dropped from CI — see https://github.com/ether/etherpad-lite/issues/XXXX
    // Kept chromium and firefox as the supported browsers.

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
