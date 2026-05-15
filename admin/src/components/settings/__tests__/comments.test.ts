// admin/src/components/settings/__tests__/comments.test.ts
//
// Regression coverage for https://github.com/ether/etherpad/issues/7740.
// A previous version of findLeading treated any line ending in `*/` as a
// comment continuation; a JSON line like
//   "altF9": true, /* focus on the File Menu and/or editbar */
// then leaked into the next sibling's "leading comment", which the form
// view rendered as the row label.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractAdjacentComments } from '../comments.ts';
import { humanize, labelAndHelp } from '../labels.ts';

const padShortcutText = `{
  "padShortcutEnabled" : {
    "altF9":     true, /* focus on the File Menu and/or editbar */
    "altC":      true, /* focus on the Chat window */
    "cmdShift2": true, /* shows a gritter popup showing a line author */
    "delete":    true,
    "return":    true,
    "esc":       true, /* in mozilla versions 14-19 avoid reconnecting pad */
    "cmdS":      true  /* save a revision */
  }
}`;

const offsetsFor = (text: string, key: string) => {
  const keyOffset = text.indexOf(`"${key}"`);
  const valOffset = text.indexOf('true', keyOffset);
  return { keyOffset, valOffset, valLength: 4 };
};

test('does not absorb prior JSON line with trailing comment as leading', () => {
  const { keyOffset, valOffset, valLength } = offsetsFor(padShortcutText, 'altC');
  const { leading, trailing } =
    extractAdjacentComments(padShortcutText, keyOffset, valOffset, valLength);
  assert.equal(leading, '');
  assert.equal(trailing, 'focus on the Chat window');
});

test('does not accumulate multiple prior trailing-comment lines', () => {
  const { keyOffset, valOffset, valLength } = offsetsFor(padShortcutText, 'cmdShift2');
  const { leading } =
    extractAdjacentComments(padShortcutText, keyOffset, valOffset, valLength);
  assert.equal(leading, '');
});

test('leading is empty when prior line is plain code (no trailing comment)', () => {
  const { keyOffset, valOffset, valLength } = offsetsFor(padShortcutText, 'return');
  const { leading } =
    extractAdjacentComments(padShortcutText, keyOffset, valOffset, valLength);
  assert.equal(leading, '');
});

test('still recognises JSDoc-style leading block comments', () => {
  const text = `{
  /*
   * Pad Shortcut Keys
   */
  "padShortcutEnabled" : {}
}`;
  const keyOffset = text.indexOf('"padShortcutEnabled"');
  const valOffset = text.indexOf('{}');
  const { leading, trailing } = extractAdjacentComments(text, keyOffset, valOffset, 2);
  assert.equal(leading, 'Pad Shortcut Keys');
  assert.equal(trailing, '');
});

test('still recognises single-line // leading comments', () => {
  const text = `{
  // Whether to enable the thing.
  "thing": true
}`;
  const keyOffset = text.indexOf('"thing"');
  const valOffset = text.indexOf('true');
  const { leading } = extractAdjacentComments(text, keyOffset, valOffset, 4);
  assert.equal(leading, 'Whether to enable the thing.');
});

test('humanize spaces camelCase and capitalises only the first word', () => {
  assert.equal(humanize('requireAuthentication'), 'Require authentication');
  assert.equal(humanize('altF9'), 'Alt f9');
});

test('labelAndHelp splits a leading block at the first sentence boundary', () => {
  const { label, help } = labelAndHelp(
    'Name your instance! Optional context follows.',
    'title',
  );
  assert.equal(label, 'Name your instance!');
  assert.equal(help, 'Optional context follows.');
});
