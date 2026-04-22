'use strict';

// Regression tests for bin/setup-trusted-publishers.sh.
//
// We can't and don't want to call the real `npm trust github` registry from
// CI, so we shim `npm` with a fake binary placed earlier on $PATH. The fake
// binary records every invocation to a log file; the assertions below replay
// that log to verify:
//
//   1. `--file` is given the workflow *basename* (`test-and-release.yml`),
//      never a full path. Real `npm trust github` rejects paths.
//   2. `--otp <code>` is forwarded to every `npm trust github` call when the
//      script is invoked with `--otp`.
//   3. The script doesn't bail out under `set -eu` when `npm trust github`
//      exits non-zero — it must keep going so `--skip-existing` can take
//      effect on 409 Conflict responses.

import {strict as assert} from 'assert';
import {spawnSync} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'bin', 'setup-trusted-publishers.sh');

type Invocation = string[];

const makeFakeNpm = (
  workdir: string,
  opts: {trustExitCode?: number; trustStderr?: string} = {},
): {logFile: string; binDir: string} => {
  const binDir = path.join(workdir, 'bin');
  fs.mkdirSync(binDir, {recursive: true});
  const logFile = path.join(workdir, 'npm-calls.log');
  fs.writeFileSync(logFile, '');

  // The fake npm records each invocation as one line of NUL-separated args
  // followed by a record-separator (0x1e). That keeps quoting / spacing safe
  // when we parse it back in JS.
  const trustExit = opts.trustExitCode ?? 0;
  const trustStderr = (opts.trustStderr ?? '').replace(/'/g, `'\\''`);
  const script = `#!/bin/sh
# Fake npm used by setup-trusted-publishers regression tests.
case "$1" in
  --version)
    echo "11.5.1"
    exit 0
    ;;
  whoami)
    echo "mockuser"
    exit 0
    ;;
  trust)
    {
      for arg in "$@"; do
        printf '%s\\0' "$arg" >> "${logFile}"
      done
      printf '\\036' >> "${logFile}"
    }
    if [ -n '${trustStderr}' ]; then
      printf '%s\\n' '${trustStderr}' >&2
    fi
    exit ${trustExit}
    ;;
  *)
    # Unknown subcommand — be loud so a regression in argv parsing surfaces.
    echo "fake-npm: unexpected invocation: $*" >&2
    exit 99
    ;;
esac
`;
  const npmPath = path.join(binDir, 'npm');
  fs.writeFileSync(npmPath, script);
  fs.chmodSync(npmPath, 0o755);
  return {logFile, binDir};
};

const readInvocations = (logFile: string): Invocation[] => {
  const raw = fs.readFileSync(logFile, 'utf8');
  if (raw.length === 0) return [];
  return raw
    .split('\x1e')
    .filter((rec) => rec.length > 0)
    .map((rec) => rec.split('\x00').filter((a) => a.length > 0));
};

const runScript = (
  binDir: string,
  args: string[],
): {status: number | null; stdout: string; stderr: string} => {
  const env = {...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}`};
  const result = spawnSync('sh', [SCRIPT, ...args], {env, encoding: 'utf8'});
  return {status: result.status, stdout: result.stdout, stderr: result.stderr};
};

describe(__filename, function () {
  let workdir: string;

  beforeEach(function () {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-test-'));
  });

  afterEach(function () {
    fs.rmSync(workdir, {recursive: true, force: true});
  });

  it('passes the workflow basename, not a path, to --file', function () {
    const {logFile, binDir} = makeFakeNpm(workdir);
    const {status, stderr} = runScript(binDir, [
      '--packages', 'ep_align,ep_webrtc',
      '--skip-existing',
    ]);
    assert.equal(status, 0, `script exited ${status}: ${stderr}`);

    const calls = readInvocations(logFile);
    assert.equal(calls.length, 2, `expected 2 npm trust calls, got ${calls.length}`);

    for (const call of calls) {
      const fileIdx = call.indexOf('--file');
      assert.notEqual(fileIdx, -1, `--file missing in: ${call.join(' ')}`);
      const fileArg = call[fileIdx + 1];
      assert.equal(
        fileArg, 'test-and-release.yml',
        `--file got "${fileArg}", expected the basename "test-and-release.yml"`,
      );
      assert.ok(
        !fileArg.includes('/'),
        `--file value "${fileArg}" must not contain a path separator`,
      );
    }
  });

  it('uses releaseEtherpad.yml (basename) for ep_etherpad', function () {
    const {logFile, binDir} = makeFakeNpm(workdir);
    const {status} = runScript(binDir, [
      '--packages', 'ep_etherpad',
      '--skip-existing',
    ]);
    assert.equal(status, 0);

    const calls = readInvocations(logFile);
    assert.equal(calls.length, 1);
    const fileIdx = calls[0].indexOf('--file');
    assert.equal(calls[0][fileIdx + 1], 'releaseEtherpad.yml');
  });

  it('forwards --otp to every npm trust github call', function () {
    const {logFile, binDir} = makeFakeNpm(workdir);
    const {status} = runScript(binDir, [
      '--otp', '654321',
      '--packages', 'ep_align,ep_webrtc,ep_etherpad',
      '--skip-existing',
    ]);
    assert.equal(status, 0);

    const calls = readInvocations(logFile);
    assert.equal(calls.length, 3);
    for (const call of calls) {
      const otpIdx = call.indexOf('--otp');
      assert.notEqual(otpIdx, -1, `--otp missing in: ${call.join(' ')}`);
      assert.equal(call[otpIdx + 1], '654321');
    }
  });

  it('omits --otp when the flag was not given', function () {
    const {logFile, binDir} = makeFakeNpm(workdir);
    runScript(binDir, ['--packages', 'ep_align', '--skip-existing']);

    const calls = readInvocations(logFile);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].indexOf('--otp'), -1, `unexpected --otp in: ${calls[0].join(' ')}`);
  });

  it('keeps going under set -eu when npm trust github exits non-zero', function () {
    // Simulate the registry's 409 Conflict response. Without the set +e
    // shim around the npm call, the script would die on the first package
    // and never reach the second one — so seeing TWO recorded calls proves
    // the loop survived a non-zero exit.
    const {logFile, binDir} = makeFakeNpm(workdir, {
      trustExitCode: 1,
      trustStderr: 'npm error code E409\nnpm error 409 Conflict - already configured',
    });
    const {status} = runScript(binDir, [
      '--packages', 'ep_align,ep_webrtc',
      '--skip-existing',
    ]);
    assert.equal(status, 0, 'script should exit 0 when --skip-existing absorbs 409s');

    const calls = readInvocations(logFile);
    assert.equal(
      calls.length, 2,
      `expected the loop to invoke npm twice despite the first failure, got ${calls.length}`,
    );
  });
});
