import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, modify, parse } from 'jsonc-parser';

import { escapeForInput, unescapeFromInput } from '../stringEscapes.ts';

// Regression for https://github.com/ether/etherpad/issues/8211.

test('newlines and backslashes are shown as JSON escapes', () => {
  assert.equal(escapeForInput('Welcome\n\ntest\n'), 'Welcome\\n\\ntest\\n');
  assert.equal(escapeForInput('C:\\dir\tx\r'), 'C:\\\\dir\\tx\\r');
  assert.equal(escapeForInput('\u0001'), '\\u0001');
});

test('quotes and slashes stay readable', () => {
  assert.equal(escapeForInput('say "hi" https://etherpad.org'), 'say "hi" https://etherpad.org');
});

test('typed escape sequences decode to the characters they name', () => {
  assert.equal(unescapeFromInput('Welcome\\n\\ntest\\n'), 'Welcome\n\ntest\n');
  assert.equal(unescapeFromInput('a\\"b\\/c\\\\d\\te\\u00e9'), 'a"b/c\\d\te\u00e9');
  assert.equal(unescapeFromInput('plain "quoted" text'), 'plain "quoted" text');
});

test('invalid or incomplete escapes are rejected', () => {
  assert.equal(unescapeFromInput('trailing\\'), null);
  assert.equal(unescapeFromInput('bad \\q escape'), null);
  assert.equal(unescapeFromInput('short \\u12'), null);
});

test('round-trips arbitrary strings', () => {
  for (const s of ['', 'x', 'Welcome to Etherpad!\n\nGet involved\n', 'a\\n', '"\\"', '\u2028\u0000']) {
    assert.equal(unescapeFromInput(escapeForInput(s)), s);
  }
});

test('typed \\n is written to settings JSON as \\n, not \\\\n', () => {
  const text = '{\n  "defaultPadText": "old"\n}';
  const decoded = unescapeFromInput('Welcome\\n\\ntest\\n');
  const next = applyEdits(text, modify(text, ['defaultPadText'], decoded, {
    formattingOptions: { tabSize: 2, insertSpaces: true, eol: '\n' },
  }));
  assert.ok(next.includes('"Welcome\\n\\ntest\\n"'), next);
  assert.equal(parse(next).defaultPadText, 'Welcome\n\ntest\n');
});
