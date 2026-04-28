import {defineConfig, devices, test} from '@playwright/test';


export const defaultExpectTimeout = process.env.CI ? 20 * 1000 : 5000
export const defaultTestTimeout = 90 * 1000

/**
 * See https://playwright.dev/docs/test-configuration.
 */
// Mirror of how tests/backend/specs picks up plugin specs from
// `../node_modules/ep_*/static/tests/backend/specs/**`. Plugins that
// ship Playwright frontend tests at the conventional location below are
// discovered automatically when the plugin is installed alongside core.
//
// Path is relative to `testDir` (which is './' so the same root as
// playwright resolves from). Quirk: testDir defaults to one path; we
// expand to '.' so the testMatch globs can reach both core's tests and
// node_modules paths above src/.
//
// See docs/PLUGIN_FRONTEND_TESTS.md for the per-plugin spec layout
// convention.
const testDirRoot = '.';
const testMatchGlobs = [
    'tests/frontend-new/specs/**/*.spec.ts',
    // Plugins installed via `pnpm add -w ep_*` (CI / dev workspace).
    '../node_modules/ep_*/static/tests/frontend-new/specs/**/*.spec.ts',
    // Plugins installed via the admin UI / live-plugin-manager land
    // here instead of node_modules.
    'plugin_packages/ep_*/static/tests/frontend-new/specs/**/*.spec.ts',
];

export default defineConfig({
    testDir: testDirRoot,
    testMatch: testMatchGlobs,
    /* Run tests in files in parallel */
    fullyParallel: true,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: process.env.CI ? [['github'], ['list']] : 'html',
    expect: { timeout: defaultExpectTimeout },
    timeout: defaultTestTimeout,
    retries: process.env.CI ? 2 : 0,
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
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },

        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
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
