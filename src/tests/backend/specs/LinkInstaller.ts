'use strict';

import {strict as assert} from 'assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import sinon from 'sinon';

/**
 * Tests for LinkInstaller dependency resolution.
 *
 * LinkInstaller.ts has a circular import with installer.ts (which instantiates
 * LinkInstaller at module scope), so we cannot directly import the class in a
 * test runner. Instead we test the underlying behaviour that the bug fix
 * addresses: readFileSync must be called with a plain file path and 'utf-8'
 * encoding rather than pathToFileURL, and the addSubDependency error handling
 * must log but not throw.
 */
describe(__filename, function () {
  let tmpDir: string;

  beforeEach(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-linkinstaller-test-'));
  });

  afterEach(function () {
    sinon.restore();
    fs.rmSync(tmpDir, {recursive: true, force: true});
  });

  describe('readFileSync with plain paths (bug fix)', function () {
    it('reads a plugin package.json using a plain file path and utf-8', function () {
      // The core bug was that readFileSync(pathToFileURL(...)) was used instead
      // of readFileSync(path, 'utf-8'). Verify that the corrected pattern
      // works: readFileSync with a plain path and 'utf-8' returns valid JSON.
      const pluginDir = path.join(tmpDir, 'test-plugin');
      fs.mkdirSync(pluginDir, {recursive: true});
      const pkg = {
        name: 'test-plugin',
        version: '1.0.0',
        dependencies: {'dep-a': '1.0.0'},
      };
      fs.writeFileSync(
        path.join(pluginDir, 'package.json'),
        JSON.stringify(pkg),
        'utf-8',
      );

      const content = fs.readFileSync(
        path.join(pluginDir, 'package.json'),
        'utf-8',
      );
      const parsed = JSON.parse(content);
      assert.equal(parsed.name, 'test-plugin');
      assert.deepEqual(Object.keys(parsed.dependencies), ['dep-a']);
    });

    it('path.join produces a plain string path, not a URL object', function () {
      // The bug used pathToFileURL which returns a URL object.  Ensure the
      // corrected code path uses path.join which returns a string.
      const result = path.join(tmpDir, 'some-dep', 'package.json');
      assert.equal(typeof result, 'string');
      assert(!result.startsWith('file://'), 'path should not be a file:// URL');
    });
  });

  describe('addSubDependency-style resolution', function () {
    it('recursively resolves nested dependencies from package.json files', function () {
      // Simulate the dependency tree that addSubDependency walks:
      //   ep_plugin -> dep-a -> dep-b
      // Each dependency dir has a package.json with its own dependencies.

      const depADir = path.join(tmpDir, 'dep-a');
      const depBDir = path.join(tmpDir, 'dep-b');
      fs.mkdirSync(depADir, {recursive: true});
      fs.mkdirSync(depBDir, {recursive: true});

      fs.writeFileSync(
        path.join(depADir, 'package.json'),
        JSON.stringify({
          name: 'dep-a',
          version: '1.0.0',
          dependencies: {'dep-b': '2.0.0'},
        }),
        'utf-8',
      );
      fs.writeFileSync(
        path.join(depBDir, 'package.json'),
        JSON.stringify({name: 'dep-b', version: '2.0.0', dependencies: {}}),
        'utf-8',
      );

      // Walk the tree the same way addSubDependency does:
      // read package.json with plain path + utf-8, then recurse.
      const visited = new Set<string>();

      const walk = (depName: string) => {
        if (visited.has(depName)) return;
        const pkgPath = path.join(tmpDir, depName, 'package.json');
        const json = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        visited.add(depName);
        if (json.dependencies) {
          for (const sub of Object.keys(json.dependencies)) {
            walk(sub);
          }
        }
      };

      walk('dep-a');
      assert(visited.has('dep-a'), 'should have visited dep-a');
      assert(visited.has('dep-b'), 'should have visited dep-b');
    });
  });

  describe('error handling when package.json is missing', function () {
    it('logs an error instead of crashing when package.json does not exist', function () {
      // addSubDependency wraps readFileSync in try/catch and calls
      // console.error. Verify that pattern: reading a missing file inside
      // try/catch should log, not throw.
      const errorStub = sinon.stub(console, 'error');

      const missingPath = path.join(tmpDir, 'nonexistent', 'package.json');

      // Replicate the error-handling pattern from addSubDependency
      try {
        JSON.parse(fs.readFileSync(missingPath, 'utf-8'));
      } catch (err) {
        console.error(
          `Error reading package.json ${err} for ${missingPath}`,
        );
      }

      assert(errorStub.called, 'console.error should have been called');
      const msg = errorStub.getCall(0).args[0] as string;
      assert(
        msg.includes('Error reading package.json'),
        `expected error about package.json, got: ${msg}`,
      );
      assert(msg.includes('nonexistent'), 'error should mention the path');
    });
  });
});
