'use strict';

const assert = require('assert').strict;
const runCmd = require('../../../node/utils/run_cmd');

describe(__filename, function () {
  it('rejects with ENOENT when the binary does not exist', async function () {
    // Regression: spawn errors used to be emitted as an unlistened
    // 'error' event, which Node.js promotes to an uncaught exception
    // and bypasses any try/catch around the awaited promise. The .deb
    // package hits this on first boot via the `pnpm --version` startup
    // probe in plugins.ts; the catch silently failed and the process
    // exited mid-startup. The fix wires proc.on('error', reject).
    let caught: any;
    try {
      await runCmd(['definitely-not-a-real-binary-xyzzy-7583'], {stdio: 'string'});
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'expected promise to reject');
    assert.equal(caught.code, 'ENOENT');
  });

  it('resolves stdout for a successful command', async function () {
    const stdout = await runCmd(['node', '-e', 'process.stdout.write("ok")'],
        {stdio: [null, 'string']});
    assert.equal(stdout, 'ok');
  });

  it('rejects when the command exits with non-zero', async function () {
    let caught: any;
    try {
      await runCmd(['node', '-e', 'process.exit(7)']);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'expected promise to reject');
    assert.equal(caught.code, 7);
  });
});
