'use strict';

import {readFileSync, readdirSync} from 'fs';
import {join} from 'path';
import {describe, it, expect} from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const localesDir = join(repoRoot, 'src', 'locales');
const localeFiles = readdirSync(localesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(localesDir, f));

const macroRe = /\{\[\s*([a-zA-Z]+)\(([a-zA-Z]+)\)((\s*([a-zA-Z]+): ?([ a-zA-Z{}]+),?)+)*\s*]}/g;
const allowedMacros = new Set(['plural']);
const allowedPluralOptions = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

describe('locale files', () => {
  it('current locale corpus contains no unsupported macros', () => {
    const failures: string[] = [];
    for (const file of localeFiles) {
      const rel = file.replace(repoRoot + '/', '');
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
      for (const [key, value] of Object.entries(parsed)) {
        if (key === '@metadata') continue;
        let match;
        while ((match = macroRe.exec(value)) !== null) {
          const macroName = match[1];
          const options = match[3] ?? '';
          if (!allowedMacros.has(macroName)) failures.push(`${rel}:${key}:${macroName}`);
          if (macroName !== 'plural') continue;
          const optionMatches = options.match(/[a-zA-Z]+:/g) ?? [];
          for (const option of optionMatches) {
            const name = option.slice(0, -1);
            if (!allowedPluralOptions.has(name)) failures.push(`${rel}:${key}:${name}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  for (const file of localeFiles) {
    const rel = file.replace(repoRoot + '/', '');

    it(`${rel} contains a JSON object of string translations`, () => {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      expect(parsed, `${rel} must contain a JSON object`).toBeTruthy();
      expect(Array.isArray(parsed), `${rel} must not contain a JSON array`).toBe(false);
      expect(typeof parsed, `${rel} must contain a JSON object`).toBe('object');
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (key === '@metadata') {
          expect(value != null && typeof value === 'object' && !Array.isArray(value),
            `${rel} key @metadata must map to an object`).toBe(true);
          continue;
        }
        expect(typeof value, `${rel} key ${key} must map to a string`).toBe('string');
      }
    });

  }
});
