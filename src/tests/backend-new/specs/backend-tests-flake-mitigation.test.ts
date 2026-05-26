'use strict';

// Source-level lint pinning the Windows + Node 24 backend-test flake
// mitigations from PR #7748. Two independent attacks at the failure:
//
//   1. Mocha --exit on the Windows CI jobs so the post-suite event-loop
//      drain — where Windows + Node 24 hard-kills the process — never
//      executes. Scoped to Windows so Linux/local runs still surface
//      real handle leaks via natural drain.
//   2. NODE_OPTIONS=--report-on-fatalerror (and friends) on every
//      Backend tests step, with the resulting node-report/ directory
//      uploaded as an artifact on failure. If the flake recurs we
//      finally get a V8 stack + libuv handle table.
//
// Both pieces are easy to silently revert in a workflow refactor; this
// test fails fast if either disappears.

import {readFileSync} from 'fs';
import {join} from 'path';
import {describe, it, expect} from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

const workflow = read('.github/workflows/backend-tests.yml');

describe('backend-tests flake mitigation (PR #7748)', () => {
  it('every Backend tests step exposes Node diagnostic reports via NODE_OPTIONS', () => {
    // Count the "Run the backend tests" steps so the expected-count is
    // explicit — if a job is added later, this test reminds the author
    // to wire the diag flags into it too.
    const runStepCount = (workflow.match(/name: Run the backend tests/g) || []).length;
    expect(runStepCount, 'expected 4 Backend tests step blocks (Linux × 2, Windows × 2)')
      .toBe(4);
    const nodeOptionsCount = (workflow.match(
      /--report-on-fatalerror --report-uncaught-exception --report-on-signal --report-compact/g,
    ) || []).length;
    expect(nodeOptionsCount,
      'every Backend tests step must set NODE_OPTIONS with the report-on-fatalerror diag flags')
      .toBe(runStepCount);
    const uploadCount = (workflow.match(/name: Upload Node diagnostic reports on failure/g) || [])
      .length;
    expect(uploadCount,
      'every Backend tests step must be followed by an Upload Node diagnostic reports step')
      .toBe(runStepCount);
  });

  it.skip('Windows backend-test steps invoke pnpm test with --exit (PROBE: temporarily disabled)', () => {
    // PROBE branch only — see PR #7856. The original assertion enforced
    // that the post-suite-drain mitigation from PR #7748 stays in place.
    // This probe deliberately drops --exit to see whether (a) the original
    // post-suite hard-kill bug still reproduces on current Node 24.x, or
    // (b) --exit was also masking signal from the mid-suite silent flake.
    // The .skip is REQUIRED for the probe branch to run; if this is in a
    // PR targeted at develop, revert it before merge.
    const exitCount = (workflow.match(/pnpm test -- --exit/g) || []).length;
    expect(exitCount, 'Windows × 2 jobs must pass --exit to pnpm test')
      .toBe(2);
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
