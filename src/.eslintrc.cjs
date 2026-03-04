'use strict';

// This is a workaround for https://github.com/eslint/eslint/issues/3458
require('eslint-config-etherpad/patch/modern-module-resolution');

module.exports = {
  ignorePatterns: [
    '/static/js/vendors/browser.js',
    '/static/js/vendors/farbtastic.js',
    '/static/js/vendors/gritter.js',
    '/static/js/vendors/html10n.js',
    '/static/js/vendors/jquery.js',
    '/static/js/vendors/nice-select.js',
    '/tests/frontend/lib/',
  ],
  overrides: [
    {
      files: [
        '**/.eslintrc.*',
      ],
      extends: 'etherpad/node',
    },
    {
      files: [
        '**/*',
      ],
      excludedFiles: [
        '**/.eslintrc.*',
        'tests/frontend/**/*',
      ],
      extends: 'etherpad/node',
    },
    {
      files: [
        'static/**/*',
        'tests/frontend/helper.js',
        'tests/frontend/helper/**/*',
      ],
      excludedFiles: [
        '**/.eslintrc.*',
      ],
      extends: 'etherpad/browser',
      env: {
        'shared-node-browser': true,
      },
      overrides: [
        {
          files: [
            'tests/frontend/helper/**/*',
          ],
          globals: {
            helper: 'readonly',
          },
        },
      ],
    },
    {
      files: [
        'tests/**/*',
      ],
      excludedFiles: [
        '**/.eslintrc.*',
        'tests/frontend/cypress/**/*',
        'tests/frontend/helper.js',
        'tests/frontend/helper/**/*',
        'tests/frontend/travis/**/*',
        'tests/ratelimit/**/*',
      ],
      extends: 'etherpad/tests',
      rules: {
        'mocha/no-exports': 'off',
        'mocha/no-top-level-hooks': 'off',
      },
    },
    {
      files: [
        'tests/backend/**/*',
      ],
      excludedFiles: [
        '**/.eslintrc.*',
      ],
      extends: 'etherpad/tests/backend',
      overrides: [
        {
          files: [
            'tests/backend/**/*',
          ],
          excludedFiles: [
            'tests/backend/specs/**/*',
          ],
          rules: {
            'mocha/no-exports': 'off',
            'mocha/no-top-level-hooks': 'off',
          },
        },
      ],
    },
    {
      files: [
        'tests/frontend/**/*',
      ],
      excludedFiles: [
        '**/.eslintrc.*',
        'tests/frontend/cypress/**/*',
        'tests/frontend/helper.js',
        'tests/frontend/helper/**/*',
        'tests/frontend/travis/**/*',
      ],
      extends: 'etherpad/tests/frontend',
      overrides: [
        {
          files: [
            'tests/frontend/**/*',
          ],
          excludedFiles: [
            'tests/frontend/specs/**/*',
          ],
          rules: {
            'mocha/no-exports': 'off',
            'mocha/no-top-level-hooks': 'off',
          },
        },
      ],
    },
    {
      files: [
        'tests/frontend/cypress/**/*',
      ],
      extends: 'etherpad/tests/cypress',
    },
    {
      files: [
        'tests/frontend/travis/**/*',
      ],
      extends: 'etherpad/node',
    },
  ],
  root: true,
};
