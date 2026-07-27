import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';

import { EnvPill } from '../EnvPill.tsx';

i18next.init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'admin_settings.env_pill.tooltip': 'env {{variable}}',
        'admin_settings.env_pill.default_label': 'default',
        'admin_settings.env_pill.input_aria': 'aria {{variable}}',
        'admin_settings.env_pill.runtime_label': 'active value',
        'admin_settings.env_pill.runtime_tooltip': 'using {{variable}}',
        'admin_settings.env_pill.redacted_tooltip': 'hidden {{variable}}',
      },
    },
  },
  interpolation: { escapeValue: false },
});

const wrap = (el: React.ReactElement) =>
  renderToStaticMarkup(
    React.createElement(I18nextProvider, { i18n: i18next }, el),
  );

test('omits runtime chip when resolvedValue is undefined', () => {
  const html = wrap(React.createElement(EnvPill, {
    placeholder: { variable: 'DB_TYPE', defaultValue: 'dirty' },
    path: ['dbType'],
    onChange: () => {},
  }));
  assert.ok(!html.includes('settings-widget-env-runtime'),
    `runtime chip should be absent, got: ${html}`);
});

test('renders runtime chip with resolved value', () => {
  const html = wrap(React.createElement(EnvPill, {
    placeholder: { variable: 'DB_TYPE', defaultValue: 'dirty' },
    path: ['dbType'],
    onChange: () => {},
    resolvedValue: 'sqlite',
  } as any));
  assert.ok(html.includes('settings-widget-env-runtime'),
    `runtime chip class should appear, got: ${html}`);
  assert.ok(html.includes('sqlite'),
    `resolved value text should appear, got: ${html}`);
});

test('renders redacted chip when resolvedValue is [REDACTED]', () => {
  const html = wrap(React.createElement(EnvPill, {
    placeholder: { variable: 'DB_PASS', defaultValue: '' },
    path: ['dbSettings', 'password'],
    onChange: () => {},
    resolvedValue: '[REDACTED]',
  } as any));
  assert.ok(html.includes('settings-widget-env-runtime-redacted'),
    `redacted chip class should appear, got: ${html}`);
  assert.ok(!html.includes('[REDACTED]'),
    `literal sentinel must not be displayed to the user, got: ${html}`);
});

test('coerces non-string resolved values to display strings', () => {
  const html = wrap(React.createElement(EnvPill, {
    placeholder: { variable: 'TRUST_PROXY', defaultValue: 'false' },
    path: ['trustProxy'],
    onChange: () => {},
    resolvedValue: true,
  } as any));
  assert.ok(html.includes('true'), `expected "true" in ${html}`);
});

test('renders null resolved value as the string null', () => {
  const html = wrap(React.createElement(EnvPill, {
    placeholder: { variable: 'IP', defaultValue: '' },
    path: ['ip'],
    onChange: () => {},
    resolvedValue: null,
  } as any));
  assert.ok(html.includes('null'), `expected "null" in ${html}`);
});
