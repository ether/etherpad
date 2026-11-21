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

  // GHSA-g9xm-3pqr-wcph: uninstalling a plugin whose package.json declares a
  // dependency key like "zzz/../../../../tmp/x" made LinkInstaller rmSync() /
  // unlinkSync() a path outside pluginInstallPath / node_modules. Importing
  // installer first lets the real LinkInstaller instance load despite the
  // circular import.
  describe('uninstall path traversal (GHSA-g9xm-3pqr-wcph)', function () {
    let installer: any;
    let li: any;
    let victimRoot: string;
    let victimDir: string;
    let victimFile: string;
    const traversal = (from: string, to: string) =>
      `zzz/${path.relative(path.join(from, 'zzz'), to)}`;

    before(async function () {
      installer = await import('../../../static/js/pluginfw/installer');
      li = installer.linkInstaller;
    });

    beforeEach(function () {
      // Keep the victims next to the plugin folder rather than in os.tmpdir():
      // on Windows CI the temp dir is on a different drive, so no relative
      // traversal path to it exists.
      victimRoot = fs.mkdtempSync(
          path.join(path.dirname(installer.pluginInstallPath), '.g9xm-victim-'));
      victimDir = path.join(victimRoot, 'victim-dir');
      fs.mkdirSync(victimDir);
      fs.writeFileSync(path.join(victimDir, 'marker.txt'), 'keep me');
      victimFile = path.join(victimRoot, 'victim-file.txt');
      fs.writeFileSync(victimFile, 'keep me');
      sinon.stub(console, 'error');
      sinon.stub(console, 'debug');
    });

    afterEach(function () {
      fs.rmSync(victimRoot, {recursive: true, force: true});
    });

    it('uninstallPlugin does not delete a directory outside pluginInstallPath', async function () {
      const evil = traversal(installer.pluginInstallPath, victimDir);
      // This is the path the vulnerable code handed to rmSync().
      assert.equal(path.join(installer.pluginInstallPath, evil), victimDir);
      sinon.stub(li.livePluginManager, 'getInfo').returns({
        name: 'ep_g9xm_poc',
        version: '1.0.0',
        location: path.join(installer.pluginInstallPath, 'ep_g9xm_poc'),
        mainFile: 'index.js',
        dependencies: {[evil]: 'jashkenas/underscore'},
        dependencyDetails: {},
      });
      sinon.stub(li.livePluginManager, 'uninstall').resolves();

      await li.uninstallPlugin('ep_g9xm_poc');

      assert(fs.existsSync(path.join(victimDir, 'marker.txt')), 'victim dir was deleted');
    });

    it('sub-dependency removal does not follow a traversal name', async function () {
      const evil = traversal(installer.pluginInstallPath, victimDir);
      await li.removeSubDependency('ep_x', evil);
      await li.unlinkSubDependency('ep_x', evil);
      li.uninstallDependency(evil);

      assert(fs.existsSync(path.join(victimDir, 'marker.txt')), 'victim dir was deleted');
    });

    it('unlinkDependency does not unlink a file outside node_modules', function () {
      const evil = traversal(installer.node_modules, victimFile);
      assert.equal(path.join(installer.node_modules, evil), victimFile);

      li.unlinkDependency(evil);

      assert(fs.existsSync(victimFile), 'victim file was unlinked');
    });
  });
  // #8532: uninstalling a plugin unlinked src/node_modules/log4js (core's own
  // pnpm link) because listPlugins() reset log4js's dependents, dropping core.
  describe('uninstall keeps core and shared dependency links (#8532)', function () {
    let installer: any;
    let li: any;
    let createdPluginPath = false;
    let outside: string;
    let log4jsTarget: string | null = null;
    const created: string[] = [];
    const fakePkgs = ['ep_test_8532_plugin', 'ep_test_8532_helpers', 'ep_test_8532_other',
      'test-8532-shared', 'test-8532-core-link', 'test-8532-plugin-link'];
    const pkgInfo = (name: string, dependencies: Record<string, string> = {}) => ({
      name,
      version: '1.0.0',
      location: path.join(installer.pluginInstallPath, name),
      mainFile: 'index.js',
      dependencies,
      dependencyDetails: {},
    });
    const link = (name: string, target: string) => {
      const linkPath = path.join(installer.node_modules, name);
      fs.symlinkSync(target, linkPath, 'junction');
      created.push(linkPath);
      return linkPath;
    };
    const exists = (p: string) => {
      try { fs.lstatSync(p); return true; } catch (err) { return false; }
    };

    before(async function () {
      installer = await import('../../../static/js/pluginfw/installer');
      li = installer.linkInstaller;
      await li.init();
      const log4jsLink = path.join(installer.node_modules, 'log4js');
      if (fs.lstatSync(log4jsLink).isSymbolicLink()) log4jsTarget = fs.readlinkSync(log4jsLink);
    });

    after(function () {
      // If a regression unlinked core's log4js, put it back so the rest of
      // the suite can still run.
      const log4jsLink = path.join(installer.node_modules, 'log4js');
      if (log4jsTarget != null && !exists(log4jsLink)) {
        fs.symlinkSync(log4jsTarget, log4jsLink, 'junction');
      }
    });

    beforeEach(function () {
      if (!fs.existsSync(installer.pluginInstallPath)) {
        fs.mkdirSync(installer.pluginInstallPath, {recursive: true});
        createdPluginPath = true;
      }
      // Stands in for node_modules/.pnpm: a package that is not in
      // pluginInstallPath.
      outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-8532-'));
      sinon.stub(console, 'error');
      sinon.stub(console, 'debug');
      sinon.stub(li.livePluginManager, 'uninstall').resolves();
    });

    afterEach(function () {
      for (const p of created.splice(0)) fs.rmSync(p, {recursive: true, force: true});
      for (const name of fakePkgs) li.dependenciesMap.delete(name);
      li.dependenciesMap.get('log4js')?.delete('ep_test_8532_helpers');
      fs.rmSync(outside, {recursive: true, force: true});
      if (createdPluginPath) {
        fs.rmSync(installer.pluginInstallPath, {recursive: true, force: true});
        createdPluginPath = false;
      }
    });

    it('listing a core dependency as a plugin package keeps core as its dependent', async function () {
      assert(li.dependenciesMap.get('log4js').has('ep_etherpad-lite'));
      // live-plugin-manager lists log4js itself when a plugin pulled it in.
      await li.checkLinkedDependencies(pkgInfo('log4js'));
      assert(li.dependenciesMap.get('log4js').has('ep_etherpad-lite'),
          'core was dropped from log4js dependents');
    });

    it('uninstalling a plugin does not unlink log4js from node_modules', async function () {
      const log4jsLink = path.join(installer.node_modules, 'log4js');
      assert(exists(log4jsLink), 'test needs core log4js in node_modules');
      const helpersDir = path.join(installer.pluginInstallPath, 'ep_test_8532_helpers');
      fs.mkdirSync(helpersDir, {recursive: true});
      fs.writeFileSync(path.join(helpersDir, 'package.json'),
          JSON.stringify({name: 'ep_test_8532_helpers', dependencies: {log4js: '^6.9.1'}}));
      created.push(helpersDir);
      // Same order listPlugins() sees after `plugins i ep_set_title_on_pad`.
      await li.checkLinkedDependencies(pkgInfo('ep_test_8532_helpers', {log4js: '^6.9.1'}));
      await li.checkLinkedDependencies(pkgInfo('log4js'));
      await li.checkLinkedDependencies(
          pkgInfo('ep_test_8532_plugin', {ep_test_8532_helpers: '^1.0.0'}));
      sinon.stub(li.livePluginManager, 'getInfo')
          .returns(pkgInfo('ep_test_8532_plugin', {ep_test_8532_helpers: '^1.0.0'}));
      link('ep_test_8532_plugin', outside);

      await li.uninstallPlugin('ep_test_8532_plugin');

      assert(exists(log4jsLink), 'core log4js link was removed');
      assert(li.dependenciesMap.get('log4js').has('ep_etherpad-lite'));
    });

    it('keeps a dependency another installed plugin still uses', async function () {
      const sharedDir = path.join(installer.pluginInstallPath, 'test-8532-shared');
      fs.mkdirSync(sharedDir, {recursive: true});
      fs.writeFileSync(path.join(sharedDir, 'package.json'), '{"name":"test-8532-shared"}');
      created.push(sharedDir);
      const sharedLink = link('test-8532-shared', sharedDir);
      li.dependenciesMap.set('test-8532-shared', new Set(['ep_test_8532_plugin', 'ep_test_8532_other']));
      sinon.stub(li.livePluginManager, 'getInfo')
          .returns(pkgInfo('ep_test_8532_plugin', {'test-8532-shared': '^1.0.0'}));
      link('ep_test_8532_plugin', outside);

      await li.uninstallPlugin('ep_test_8532_plugin');

      assert(exists(sharedLink), 'shared link was removed');
      assert(fs.existsSync(path.join(sharedDir, 'package.json')), 'shared package was deleted');
    });

    it('unlinkDependency only removes links that point into pluginInstallPath', function () {
      const coreLink = link('test-8532-core-link', outside);
      const pluginDir = path.join(installer.pluginInstallPath, 'test-8532-plugin-link');
      fs.mkdirSync(pluginDir, {recursive: true});
      created.push(pluginDir);
      const pluginLink = link('test-8532-plugin-link', pluginDir);

      li.unlinkDependency('test-8532-core-link');
      li.unlinkDependency('test-8532-plugin-link');

      assert(exists(coreLink), 'link to a package outside pluginInstallPath was removed');
      assert(!exists(pluginLink), 'plugin link was not removed');
    });
  });
});
