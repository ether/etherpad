import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveByPath } from '../resolveByPath.ts';

test('returns undefined for null/undefined root', () => {
  assert.equal(resolveByPath(null, ['a']), undefined);
  assert.equal(resolveByPath(undefined, ['a']), undefined);
});

test('walks nested object keys', () => {
  assert.equal(resolveByPath({a: {b: {c: 42}}}, ['a', 'b', 'c']), 42);
});

test('walks arrays with numeric indices', () => {
  assert.equal(resolveByPath({xs: [10, 20, 30]}, ['xs', 1]), 20);
});

test('walks mixed objects and arrays', () => {
  assert.equal(
    resolveByPath({sso: {clients: [{id: 'A'}, {id: 'B'}]}}, ['sso', 'clients', 1, 'id']),
    'B',
  );
});

test('returns undefined for missing keys', () => {
  assert.equal(resolveByPath({a: 1}, ['b']), undefined);
  assert.equal(resolveByPath({a: {b: 1}}, ['a', 'c']), undefined);
});

test('returns undefined when traversing into a primitive', () => {
  assert.equal(resolveByPath({a: 1}, ['a', 'b']), undefined);
});

test('returns the root when path is empty', () => {
  const obj = {a: 1};
  assert.equal(resolveByPath(obj, []), obj);
});

test('handles string-form numeric indices for arrays', () => {
  assert.equal(resolveByPath({xs: [10, 20]}, ['xs', '1']), 20);
});
