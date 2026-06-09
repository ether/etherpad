'use strict';

// Regression tests for ether/etherpad#7911.
//
// The official Docker image installs pnpm directly (corepack was dropped for
// Node 25+). Standalone pnpm still honours the "packageManager" pin in
// package.json: when the pnpm baked into the image differs from that pin, pnpm
// treats every invocation — including the informational `pnpm --version` probe
// Etherpad runs at startup — as a request to self-provision the pinned build.
// With no outbound network (air-gapped / behind a corporate firewall) that
// download fails and pnpm exits non-zero, surfacing as `Failed to get pnpm
// version` and breaking offline boots.
//
// The image deliberately lags the pin (pnpm 11.1.x enforces a minimum-release-
// age policy the frozen-lockfile build can't satisfy), so the guard is not to
// force the versions equal but to neutralise the gap: the Dockerfile must set
// pnpm_config_pm_on_fail=ignore so pnpm uses the installed version instead of
// reaching for the network. This test fails if that guard is dropped while a
// version gap exists.

const assert = require('assert').strict;
import fs from 'fs';
import path from 'path';

const repoRoot = path.join(__dirname, '../../../../');
const readRepoFile = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe(__filename, function () {
  describe('Docker pnpm offline guard (issue #7911)', function () {
    let dockerfile: string;
    let imagePnpm: string;
    let pinPnpm: string;
    let guardPresent: boolean;

    before(function () {
      dockerfile = readRepoFile('Dockerfile');

      const argMatch = dockerfile.match(/^ARG PnpmVersion=(\S+)/m);
      assert.ok(argMatch, 'Dockerfile must declare `ARG PnpmVersion=<version>`');
      imagePnpm = argMatch![1];

      const pkg = JSON.parse(readRepoFile('package.json'));
      const pinMatch = String(pkg.packageManager || '').match(/^pnpm@(.+)$/);
      assert.ok(pinMatch, `expected packageManager "pnpm@<version>", got "${pkg.packageManager}"`);
      pinPnpm = pinMatch![1];

      guardPresent = /ENV\s+pnpm_config_pm_on_fail=ignore/.test(dockerfile);
    });

    it('neutralises any pnpm version gap so offline boots do not self-provision', function () {
      // The actual safety property: a mismatch between the image pnpm and the
      // package.json pin is only safe when pm_on_fail=ignore is set. (If they
      // are ever realigned, the guard becomes belt-and-suspenders, not required.)
      if (imagePnpm !== pinPnpm) {
        assert.ok(guardPresent,
            `Dockerfile pnpm ${imagePnpm} differs from package.json pnpm@${pinPnpm}, ` +
            'but pnpm_config_pm_on_fail=ignore is not set — pnpm will try to ' +
            'self-provision the pinned version and break offline/air-gapped ' +
            'startup (issue #7911).');
      }
    });

    it('sets pnpm_config_pm_on_fail=ignore for offline robustness', function () {
      assert.ok(guardPresent,
          'Dockerfile must set pnpm_config_pm_on_fail=ignore so runtime pnpm ' +
          'calls (the startup probe, the updater pnpm check) do not fail closed ' +
          'when offline (issue #7911).');
    });
  });
});
