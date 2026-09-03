'use strict';

import {readFileSync, readdirSync} from 'fs';
import {join} from 'path';
import {describe, it, expect} from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const localesDir = join(repoRoot, 'src', 'locales');
const localeFiles = readdirSync(localesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(localesDir, f));

const macroCandidateRe = /\{\[[^]*?]}/g;

const parseMacro = (candidate: string): {macroName: string, options: string} | null => {
  if (!candidate.startsWith('{[') || !candidate.endsWith(']}')) return null;
  const body = candidate.slice(2, -2).trim();
  const openParen = body.indexOf('(');
  const closeParen = body.indexOf(')', openParen + 1);
  if (openParen <= 0 || closeParen <= openParen + 1) return null;
  const macroName = body.slice(0, openParen).trim();
  const variableName = body.slice(openParen + 1, closeParen).trim();
  if (!/^[a-zA-Z]+$/.test(macroName) || !/^[a-zA-Z]+$/.test(variableName)) return null;
  return {macroName, options: body.slice(closeParen + 1).trim()};
};

const parsePluralOptionNames = (options: string): string[] | null => {
  if (options === '') return [];
  const names: string[] = [];
  let i = 0;
  while (i < options.length) {
    while (i < options.length && /\s/.test(options[i])) i++;
    const nameStart = i;
    while (i < options.length && /[a-zA-Z]/.test(options[i])) i++;
    if (nameStart === i || options[i] !== ':') return null;
    names.push(options.slice(nameStart, i));
    i++;
    while (i < options.length) {
      if (options[i] === ',') {
        i++;
        break;
      }
      i++;
    }
  }
  return names;
};
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
        for (const candidate of value.match(macroCandidateRe) ?? []) {
          const macro = parseMacro(candidate);
          if (macro == null) {
            failures.push(`${rel}:${key}:malformed:${candidate}`);
            continue;
          }
          const {macroName, options} = macro;
          if (!allowedMacros.has(macroName)) failures.push(`${rel}:${key}:${macroName}`);
          if (macroName !== 'plural') continue;
          const optionNames = parsePluralOptionNames(options);
          if (optionNames == null) {
            failures.push(`${rel}:${key}:malformed:${candidate}`);
            continue;
          }
          for (const name of optionNames) {
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
