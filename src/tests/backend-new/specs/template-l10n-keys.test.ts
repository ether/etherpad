'use strict';

// Regression: src/templates/index.html referenced `data-l10n-id="index.code"`
// but src/locales/en.json had no `index.code` key, producing a "Couldn't find
// translation key index.code" console error on the landing page (issue #7835).
// This test asserts every data-l10n-id attribute in our shipped templates has
// a matching source string in en.json so the class of bug fails in CI.

import {readFileSync, readdirSync} from 'fs';
import {join} from 'path';
import {describe, it, expect} from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const templatesDir = join(repoRoot, 'src', 'templates');
const enJsonPath = join(repoRoot, 'src', 'locales', 'en.json');

const en = JSON.parse(readFileSync(enJsonPath, 'utf8')) as Record<string, string>;

const collectKeys = (html: string): string[] => {
  const out: string[] = [];
  const re = /data-l10n-id="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
};

const templateFiles = readdirSync(templatesDir)
    .filter((f) => f.endsWith('.html'))
    .map((f) => join(templatesDir, f));

describe('template l10n keys', () => {
  for (const file of templateFiles) {
    it(`every data-l10n-id in ${file.replace(repoRoot + '/', '')} exists in en.json`, () => {
      const html = readFileSync(file, 'utf8');
      const keys = collectKeys(html);
      const missing = keys.filter((k) => !(k in en));
      expect(missing, `missing keys in en.json: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
