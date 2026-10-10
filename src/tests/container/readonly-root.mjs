import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';

// This host-side test needs Docker and an already-built image. It never pulls an
// image, publishes a port, or connects Etherpad to an external network.
const image = process.env.ETHERPAD_TEST_IMAGE;
const docker = (...args) => {
  const result = spawnSync('docker', args, {encoding: 'utf8', timeout: 30000});
  assert.ifError(result.error);
  assert.equal(result.status, 0,
      `docker ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
};

export const cleanupDockerResources = (run, {container, volume}, diagnostic) => {
  const errors = [];
  const attempt = (...args) => {
    try {
      run(...args);
    } catch (error) {
      errors.push(error);
      diagnostic(`Cleanup: ${error.message}`);
    }
  };
  if (container) {
    // An already-stopped container needs no stop. Force removal also handles a
    // failed stop, and volume removal is still attempted if removal fails.
    attempt('rm', '--force', container);
  }
  if (volume) attempt('volume', 'rm', volume);
  return errors;
};

test('read-only root: first boot and restart preserve plugin migration state', {
  skip: image ? false : 'Set ETHERPAD_TEST_IMAGE to a locally available Etherpad image',
  timeout: 180000,
}, async (t) => {
  const name = `etherpad-readonly-test-${randomUUID()}`;
  const volume = `${name}-var`;
  let volumeCreated = false;
  let containerCreated = false;
  let testFailed = false;
  const state = () => JSON.parse(docker('inspect', '--format', '{{json .State}}', name));
  const logs = () => docker('logs', name);
  const waitForHealth = async () => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const current = state();
      if (!current.Running) assert.fail(`Etherpad exited before healthy:\n${logs()}`);
      if (current.Health?.Status === 'healthy') return;
      await delay(1000);
    }
    assert.fail(`Etherpad did not become healthy within 60s:\n${logs()}`);
  };
  const readPluginState = () => docker('exec', name, 'node', '-e',
      'process.stdout.write(require("node:fs").readFileSync(' +
      '"/opt/etherpad-lite/var/installed_plugins.json", "utf8"))');
  const assertHttp = () => {
    const response = JSON.parse(docker('exec', name, 'node', '-e',
        '(async () => { const health = await fetch("http://127.0.0.1:9001/health");' +
        'const home = await fetch("http://127.0.0.1:9001/");' +
        'console.log(JSON.stringify({healthStatus: health.status, health: await health.json(),' +
        'homeStatus: home.status, homeType: home.headers.get("content-type")}));' +
        '})().catch(e => { console.error(e); process.exit(1); })'));
    assert.equal(response.healthStatus, 200);
    assert.equal(response.health.status, 'pass');
    assert.equal(response.homeStatus, 200);
    assert.match(response.homeType, /text\/html/);
  };
  try {
    const imageInfo = JSON.parse(docker('image', 'inspect', image))[0];
    t.diagnostic(JSON.stringify({image, imageId: imageInfo.Id,
      revision: imageInfo.Config.Labels?.['org.opencontainers.image.revision']}));
    // A fresh named volume inherits the image's var/ ownership. It is retained
    // across the restart, unlike a tmpfs, then removed in finally.
    docker('volume', 'create', volume);
    volumeCreated = true;
    docker('create', '--name', name, '--read-only', '--network', 'none',
        '--user', '5001:0', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--memory', '768m', '--cpus', '1', '--pids-limit', '160',
        '--tmpfs', '/tmp:rw,nosuid,nodev,size=96m,mode=1777',
        '--mount', `type=volume,source=${volume},target=/opt/etherpad-lite/var`,
        '--tmpfs', '/opt/etherpad-lite/src/plugin_packages:rw,nosuid,nodev,size=48m,uid=5001,gid=0',
        '--health-cmd', 'wget --quiet --spider http://127.0.0.1:9001/health || exit 1',
        '--health-interval', '2s', '--health-timeout', '2s', '--health-retries', '30',
        '-e', 'DB_TYPE=sqlite', '-e', 'DB_FILENAME=var/etherpad.sq3',
        '-e', 'NODE_ENV=production', '-e', 'ETHERPAD_PRODUCTION=true',
        '-e', 'PRIVACY_PLUGIN_CATALOG=false', '-e', 'PRIVACY_UPDATE_CHECK=false',
        '-e', 'UPDATES_TIER=off', image);
    containerCreated = true;
    const container = JSON.parse(docker('inspect', name))[0];
    assert.equal(container.HostConfig.ReadonlyRootfs, true);
    assert.equal(container.HostConfig.NetworkMode, 'none');
    assert.equal(container.Config.User, '5001:0');
    docker('start', name);
    await waitForHealth();
    assertHttp();
    const firstState = readPluginState();
    const plugins = JSON.parse(firstState).plugins;
    assert.ok(plugins.some((p) => p.name === 'ep_etherpad-lite'));
    const firstMigrationCount = (logs().match(/start migration of plugins in node_modules/g) || []).length;
    assert.equal(firstMigrationCount, 1, 'fresh var volume should run migration once');
    t.diagnostic('First boot: HTTP health and home OK; migration state created.');

    docker('stop', '--time', '15', name);
    const stopped = state();
    assert.equal(stopped.Running, false);
    assert.equal(stopped.OOMKilled, false);
    assert.notEqual(stopped.ExitCode, 137, 'Docker must not have to kill the process');
    // Check restart/persistence here, not unrelated shutdown behavior. The 3.3.7
    // image exits 1 after its own cleanup watchdog on both writable and read-only
    // roots; report it instead of claiming a clean shutdown or hiding the result.
    t.diagnostic(`Stop exit code: ${stopped.ExitCode} (0 is clean; nonzero needs separate investigation).`);
    docker('start', name);
    await waitForHealth();
    assertHttp();
    assert.equal(readPluginState(), firstState, 'restart must retain the migration state');
    assert.equal((logs().match(/start migration of plugins in node_modules/g) || []).length,
        firstMigrationCount, 'restart must not migrate again');
    t.diagnostic('Restart: HTTP health and home OK; migration not repeated.');
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    // Names are generated for this test only. Never remove existing user data.
    const cleanupErrors = cleanupDockerResources(docker, {
      container: containerCreated ? name : null,
      volume: volumeCreated ? volume : null,
    }, (message) => t.diagnostic(message));
    if (!testFailed && cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, 'Docker test resource cleanup failed');
    }
  }
});
