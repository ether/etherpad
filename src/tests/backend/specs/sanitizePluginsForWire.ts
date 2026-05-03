'use strict';

import {strict as assert} from 'assert';
const {sanitizePluginsForWire} = require('../../../node/handler/PadMessageHandler');

describe(__filename, function () {
  const makeRegistry = () => ({
    ep_example: {
      parts: [{name: 'ep_example', plugin: 'ep_example'}],
      package: {
        name: 'ep_example',
        version: '1.2.3',
        realPath: '/real/path/to/ep_example',
        path: '/node_modules/ep_example',
        location: '/real/path/to/ep_example',
      },
    },
    ep_other: {
      parts: [{name: 'ep_other', plugin: 'ep_other'}],
      package: {
        name: 'ep_other',
        version: '0.1.0',
        realPath: '/real/path/to/ep_other',
        path: '/node_modules/ep_other',
        location: '/real/path/to/ep_other',
      },
    },
  });

  it('returns a sanitized registry with only name and version in package', function () {
    const registry = makeRegistry();
    const sanitized = sanitizePluginsForWire(registry);
    assert.deepEqual(Object.keys(sanitized).sort(), ['ep_example', 'ep_other']);
    assert.deepEqual(sanitized.ep_example.package, {name: 'ep_example', version: '1.2.3'});
    assert.deepEqual(sanitized.ep_other.package, {name: 'ep_other', version: '0.1.0'});
  });

  it('does not mutate the input registry (issue: realPath clobbered on pad join)', function () {
    const registry = makeRegistry();
    sanitizePluginsForWire(registry);
    // The original objects MUST still carry realPath and the other internal
    // path fields — Minify.ts relies on them for every /static/plugins/...
    // asset request. Before the fix, the sanitization mutated these in place
    // and caused every such request to 500 after the first pad connection.
    assert.equal(registry.ep_example.package.realPath, '/real/path/to/ep_example');
    assert.equal(registry.ep_example.package.path, '/node_modules/ep_example');
    assert.equal(registry.ep_other.package.realPath, '/real/path/to/ep_other');
    assert.equal(registry.ep_other.package.path, '/node_modules/ep_other');
  });

  it('repeated calls remain non-destructive', function () {
    const registry = makeRegistry();
    for (let i = 0; i < 5; i++) sanitizePluginsForWire(registry);
    assert.equal(registry.ep_example.package.realPath, '/real/path/to/ep_example');
    assert.equal(registry.ep_other.package.realPath, '/real/path/to/ep_other');
  });

  it('returned copy and input are independent (mutation of result does not affect input)', function () {
    const registry = makeRegistry();
    const sanitized = sanitizePluginsForWire(registry);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sanitized.ep_example as any).package.name = 'tampered';
    assert.equal(registry.ep_example.package.name, 'ep_example');
  });
});
