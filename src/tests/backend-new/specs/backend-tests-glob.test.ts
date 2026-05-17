'use strict';

// Regression check for the `pnpm test` glob. The previous spec script
// `tests/backend/specs/**.ts` only matched files at depth 1 under
// tests/backend/specs/, silently skipping every spec under api/ and
// admin/ — including the failures filed in #7785–#7788, #7790. This
// test asserts that mocha (running the exact arguments from
// src/package.json's "test" script) still discovers a representative
// file in each of those subdirectories.
//
// If the glob is ever narrowed again, this test fails loudly instead
// of letting the affected specs slip out of CI.

import {execFileSync} from 'child_process';
import {readFileSync} from 'fs';
import {join} from 'path';
import {describe, it, expect} from 'vitest';

const srcRoot = join(__dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(srcRoot, 'package.json'), 'utf8'));

// Strip `cross-env NAME=value` prefixes and the leading binary name so we
// can pass the remaining tokens straight to npx mocha --dry-run.
const tokens = String(pkg.scripts.test).split(/\s+/);
while (tokens[0] && /^[A-Z_][A-Z0-9_]*=/.test(tokens[0])) tokens.shift();
if (tokens[0] === 'cross-env') {
  tokens.shift();
  while (tokens[0] && /^[A-Z_][A-Z0-9_]*=/.test(tokens[0])) tokens.shift();
}
// Drop the binary itself (mocha) — npx will re-add it.
if (tokens[0] === 'mocha') tokens.shift();

const REQUIRED = [
  'tests/backend/specs/api/pad.ts',
  'tests/backend/specs/api/importexportGetPost.ts',
  'tests/backend/specs/admin/authorSearch.ts',
];

describe('backend test glob', () => {
  it('discovers nested specs under tests/backend/specs/{api,admin}/', () => {
    const out = execFileSync(
        'npx', ['mocha', '--dry-run', '--list-files', ...tokens],
        {cwd: srcRoot, encoding: 'utf8', env: {...process.env, NODE_ENV: 'production'}},
    );
    // mocha --list-files prints absolute paths. Normalise to repo-relative.
    const seen = out.split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.replace(`${srcRoot}/`, ''));
    for (const required of REQUIRED) {
      expect(seen, `mocha test glob missed ${required}`).toContain(required);
    }
  }, 60000);
});
