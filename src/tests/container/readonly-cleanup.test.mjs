import assert from 'node:assert/strict';
import test from 'node:test';
import {cleanupDockerResources} from './readonly-root.mjs';

test('cleanup removes an already-stopped container without a stop command', () => {
  const calls = [];
  const errors = cleanupDockerResources((...args) => calls.push(args),
      {container: 'test-container', volume: 'test-volume'}, assert.fail);
  assert.deepEqual(calls, [['rm', '--force', 'test-container'], ['volume', 'rm', 'test-volume']]);
  assert.deepEqual(errors, []);
});

test('cleanup attempts volume removal after container removal fails', () => {
  const calls = [];
  const messages = [];
  const failure = new Error('container removal failed');
  const errors = cleanupDockerResources((...args) => {
    calls.push(args);
    if (args[0] === 'rm') throw failure;
  }, {container: 'test-container', volume: 'test-volume'}, (message) => messages.push(message));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ['volume', 'rm', 'test-volume']);
  assert.deepEqual(errors, [failure]);
  assert.match(messages[0], /container removal failed/);
});

test('cleanup reports both failures without throwing over the original failure', () => {
  const original = new Error('original startup failure');
  const messages = [];
  let caught;
  try {
    try {
      throw original;
    } finally {
      const errors = cleanupDockerResources(() => { throw new Error('cleanup failed'); },
          {container: 'test-container', volume: 'test-volume'}, (message) => messages.push(message));
      assert.equal(errors.length, 2);
    }
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, original);
  assert.equal(messages.length, 2);
});

test('cleanup only attempts resources actually created', () => {
  const calls = [];
  cleanupDockerResources((...args) => calls.push(args), {container: null, volume: 'test-volume'}, assert.fail);
  assert.deepEqual(calls, [['volume', 'rm', 'test-volume']]);
});
