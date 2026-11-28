'use strict';

// bin/plugins/checkPlugin.ts runs daily in `autopush` mode against every
// ether/ep_* plugin (see .github/workflows/update-plugins.yml). A push to a
// plugin's default branch triggers its release, which can only bump a valid
// semver version, so checkPlugin must refuse to change or push anything when
// the version is invalid.

import {strict as assert} from 'assert';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const BIN_DIR = path.join(REPO_ROOT, 'bin');

const git = (cwd: string, ...args: string[]) =>
  childProcess.execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();

describe(__filename, function () {
  this.timeout(60000);
  let tmp: string;
  let plugin: string;
  let remote: string;

  beforeEach(function () {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkPlugin-'));
    remote = path.join(tmp, 'remote.git');
    plugin = path.join(tmp, 'ep_test_invalid_version');
    git(tmp, 'init', '-q', '--bare', '-b', 'main', remote);
    git(tmp, 'clone', '-q', remote, plugin);
    git(plugin, 'config', 'user.name', 'test');
    git(plugin, 'config', 'user.email', 'test@example.com');
    git(plugin, 'checkout', '-q', '-b', 'main');
    fs.writeFileSync(path.join(plugin, 'package.json'),
        `${JSON.stringify({name: 'ep_test_invalid_version', version: '1.2'}, null, 2)}\n`);
    git(plugin, 'add', '-A');
    git(plugin, 'commit', '-q', '-m', 'init');
    git(plugin, 'push', '-q', '-u', 'origin', 'main');
  });

  afterEach(function () {
    fs.rmSync(tmp, {recursive: true, force: true});
  });

  it('autopush stops without changing or pushing a plugin with an invalid version', function () {
    const before = git(remote, 'rev-parse', 'main');
    // checkPlugin resolves the plugin as a sibling of the core checkout.
    const name = path.relative(path.dirname(REPO_ROOT), plugin);
    const res = childProcess.spawnSync(
        process.execPath, ['--import', 'tsx', './plugins/checkPlugin.ts', name, 'autopush'],
        {cwd: BIN_DIR, encoding: 'utf8'});
    assert.notEqual(res.status, 0, `checkPlugin should fail:\n${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /version '1\.2' is not valid semver/);
    assert.equal(git(plugin, 'status', '--porcelain'), '');
    assert.equal(git(remote, 'rev-parse', 'main'), before);
  });
});
