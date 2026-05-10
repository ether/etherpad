'use strict';

// Diagnostic-only mocha bootstrap, loaded via `mocha --require ./tests/backend/diagnostics.ts`.
//
// PR #7663 added unhandledRejection / uncaughtException handlers in
// tests/backend/common.ts to surface the silent ~22% backend-test flake.
// The next failure (run 25279692065, Windows without plugins, Node 24)
// showed mocha exit with code 1 mid-suite, 261ms after the last passing
// test, with NEITHER handler firing. This means the process was killed
// in a way that bypassed JS handlers — SIGKILL, OOM, or a fatal native
// error — OR mocha itself called process.exit before the handlers ran.
//
// This file:
//   1. Registers handlers UNCONDITIONALLY at mocha startup (common.ts is
//      only imported by ~27 of 47 specs, so its handlers may register
//      late or after a death-causing event).
//   2. Writes via fs.writeSync(2, ...) — synchronous stderr writes that
//      complete before the kernel returns from the syscall, so the line
//      lands in the runner log even if the process is killed
//      milliseconds later.
//   3. Tracks the last-seen test via a mocha root afterEach hook so the
//      death point is identified.
//   4. Logs exit-related events so we can discriminate:
//        beforeExit + exit  -> clean event-loop drain
//        only exit          -> process.exit() called somewhere
//        neither            -> hard kill (SIGKILL/OOM/runner)
//        signal lines       -> SIGTERM / SIGINT / SIGBREAK received
//
// Drop this file once the flake's root cause is identified and fixed.

import {writeSync} from 'node:fs';

const t0 = Date.now();
let lastSeenTest = '<no test seen yet>';

const diag = (msg: string): void => {
  const line = `[diag +${Date.now() - t0}ms] ${msg}\n`;
  try {
    writeSync(2, line);
  } catch (_) {
    // Best-effort: if stderr is closed there is nothing we can do.
  }
};

diag('diagnostics loaded');

process.on('unhandledRejection', (reason: any) => {
  diag(`unhandledRejection: ${
    reason && reason.stack ? reason.stack : String(reason)
  } (lastTest="${lastSeenTest}")`);
  // Re-throw so existing common.ts handlers / mocha behavior is preserved.
  throw reason;
});

process.on('uncaughtException', (err: any) => {
  diag(`uncaughtException: ${
    err && err.stack ? err.stack : String(err)
  } (lastTest="${lastSeenTest}")`);
  // Force fail-fast. Specs that don't import common.ts only have THIS handler,
  // and Node won't exit on its own once an uncaughtException listener is
  // registered. Without the explicit exit a fatal error would be swallowed.
  // common.ts has the same process.exit(1); whichever handler runs first wins.
  process.exit(1);
});

process.on('beforeExit', (code: number) => {
  diag(`beforeExit code=${code} exitCode=${process.exitCode} ` +
    `lastTest="${lastSeenTest}"`);
});

process.on('exit', (code: number) => {
  diag(`exit code=${code} lastTest="${lastSeenTest}"`);
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
  // SIGHUP / SIGBREAK don't exist on every platform; ignore registration errors.
  try {
    process.on(sig as any, () => {
      diag(`received ${sig} (lastTest="${lastSeenTest}")`);
      // Let the default behavior (exit) happen.
      process.exit(128);
    });
  } catch (_) {
    // ignore
  }
}

// Mocha root hook — only registered if mocha picks up this file via --require.
// We track the most recently-finished test so the death point is visible.
export const mochaHooks = {
  afterEach(this: any) {
    if (this.currentTest) {
      lastSeenTest = this.currentTest.fullTitle();
    }
  },
};
