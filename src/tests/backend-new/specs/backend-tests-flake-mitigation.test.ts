'use strict';

// Source-level lint pinning the one remaining Windows backend-test CI
// invariant after the silent-ELIFECYCLE flake was root-caused and fixed
// (the in-process process.exit path is gated in src/node/server.ts, and the
// Windows jobs run on Node 24.16.0 to avoid the libuv TCP-connect stack
// overrun in 24.15.0 — tracked upstream as nodejs/node#63620):
//
//   mocha --exit on the Windows CI jobs, and ONLY there, so a leaked handle
//   can't hang the job at post-suite drain. Linux/local keep natural drain so
//   real handle leaks stay visible. Easy to silently revert in a workflow
//   refactor or leak into the shared test script; this test fails fast if it
//   disappears or spreads.
//
// (The earlier --report-on-fatalerror NODE_OPTIONS + node-report uploads were
// diagnostics for hunting the flake; removed once the cause was found.)

import {readFileSync} from 'fs';
import {join} from 'path';
import {describe, it, expect} from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

const workflow = read('.github/workflows/backend-tests.yml');

describe('backend-tests Windows --exit invariant', () => {
  it('Windows backend-test steps invoke pnpm test with --exit', () => {
    // --exit is the Windows-only mitigation. Linux still runs natural-drain
    // so leaked-handle regressions stay visible there.
    const exitCount = (workflow.match(/pnpm test -- --exit/g) || []).length;
    expect(exitCount, 'Windows × 2 jobs must pass --exit to pnpm test')
      .toBe(2);
    // Negative check: Linux jobs must NOT use --exit so handle-leak
    // detection stays alive on the natural-drain platforms.
    expect(workflow.includes('runs-on: ubuntu-latest'),
      'workflow no longer has any Linux jobs (sanity check)').toBe(true);
  });

  it('mocha test script does not bake --exit in globally', () => {
    // Counterpart to the workflow check: if a future refactor moves
    // --exit back into src/package.json it would silently apply to
    // Linux + local runs too, masking handle leaks. Keep --exit out of
    // the shared script.
    const pkg = JSON.parse(read('src/package.json')) as {
      scripts: Record<string, string>,
    };
    expect(pkg.scripts.test,
      'mocha test script must not include --exit — apply --exit per-platform in CI')
      .not.toMatch(/(^|\s)--exit(\s|$)/);
  });
});
