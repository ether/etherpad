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
// Subsequent runs on develop (e.g. 26311025244, Windows with plugins,
// Node 24) reproduced the same fingerprint: `[diag +0ms] diagnostics
// loaded` lands but no other diag line appears before the silent
// ELIFECYCLE. Death lands 300±50 ms after the previous test's teardown
// and the lastSeenTest pointer (only updated in afterEach) tells us
// nothing about whether the next test had started or whether mocha was
// between tests at the kill moment.
//
// This file:
//   1. Registers handlers UNCONDITIONALLY at mocha startup (common.ts is
//      only imported by ~27 of 47 specs, so its handlers may register
//      late or after a death-causing event).
//   2. Writes via fs.writeSync(2, ...) — synchronous stderr writes that
//      complete before the kernel returns from the syscall, so the line
//      lands in the runner log even if the process is killed
//      milliseconds later.
//   3. Tracks BOTH the currently-running test (set in beforeEach) and the
//      last-finished test (set in afterEach), so the death point can be
//      bracketed even when the kill lands inside the next test's setup or
//      body, before its own afterEach has a chance to update the pointer.
//   4. Emits a 1Hz heartbeat carrying the running-test name, RSS / heap
//      usage, and active handle / request counts. If the process dies
//      without firing any JS handler, the last heartbeat narrows the
//      kill window to <=1s and the handle-count trace exposes leaks
//      (sockets, timers, native bindings) that would otherwise be
//      invisible at the runner-log level.
//   5. Logs exit-related events so we can discriminate:
//        beforeExit + exit  -> clean event-loop drain (Linux CI, local)
//        only exit          -> process.exit() called — expected when mocha
//                              is launched with --exit (the Windows CI
//                              jobs do this to mitigate a hard-kill flake;
//                              elsewhere "only exit" still means something
//                              else called process.exit unexpectedly)
//        neither            -> hard kill (SIGKILL/OOM/runner)
//        signal lines       -> SIGTERM / SIGINT / SIGBREAK received
//
// Drop this file once the flake's root cause is identified and fixed.

import {writeSync} from 'node:fs';

const t0 = Date.now();
let currentTest = '<no test running>';
let lastFinishedTest = '<no test finished yet>';

const diag = (msg: string): void => {
  const line = `[diag +${Date.now() - t0}ms] ${msg}\n`;
  try {
    writeSync(2, line);
  } catch (_) {
    // Best-effort: if stderr is closed there is nothing we can do.
  }
};

diag('diagnostics loaded');

// Heartbeat. unref()'d so it never holds the event loop open by itself —
// it only fires if mocha is otherwise alive. The interval cadence (1Hz) is
// the trade-off between log noise (~60-120 extra lines per run) and how
// tightly we can bracket the kill timestamp.
const heartbeat = setInterval(() => {
  const mem = process.memoryUsage();
  // _getActiveHandles / _getActiveRequests are undocumented Node internals.
  // The earlier shape `_getActiveHandles?.().length ?? -1` was a bug: `?.()`
  // only guards the call, so a missing method returns `undefined` and then
  // `.length` throws TypeError — which would take down the whole test run.
  // Capture the array first, then read .length only when it actually exists.
  const handlesArr = (process as any)._getActiveHandles?.();
  const handles = handlesArr ? handlesArr.length : -1;
  const requestsArr = (process as any)._getActiveRequests?.();
  const requests = requestsArr ? requestsArr.length : -1;
  diag(`hb running="${currentTest}" lastFinished="${lastFinishedTest}" ` +
    `rss=${Math.round(mem.rss / 1024 / 1024)}M ` +
    `heap=${Math.round(mem.heapUsed / 1024 / 1024)}M ` +
    `handles=${handles} requests=${requests}`);
}, 1000);
heartbeat.unref();

process.on('unhandledRejection', (reason: any) => {
  diag(`unhandledRejection: ${
    reason && reason.stack ? reason.stack : String(reason)
  } (running="${currentTest}", lastFinished="${lastFinishedTest}")`);
  // Re-throw so existing common.ts handlers / mocha behavior is preserved.
  throw reason;
});

process.on('uncaughtException', (err: any) => {
  diag(`uncaughtException: ${
    err && err.stack ? err.stack : String(err)
  } (running="${currentTest}", lastFinished="${lastFinishedTest}")`);
  // Force fail-fast. Specs that don't import common.ts only have THIS handler,
  // and Node won't exit on its own once an uncaughtException listener is
  // registered. Without the explicit exit a fatal error would be swallowed.
  // common.ts has the same process.exit(1); whichever handler runs first wins.
  process.exit(1);
});

process.on('beforeExit', (code: number) => {
  diag(`beforeExit code=${code} exitCode=${process.exitCode} ` +
    `running="${currentTest}" lastFinished="${lastFinishedTest}"`);
});

process.on('exit', (code: number) => {
  diag(`exit code=${code} running="${currentTest}" lastFinished="${lastFinishedTest}"`);
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
  // SIGHUP / SIGBREAK don't exist on every platform; ignore registration errors.
  try {
    process.on(sig as any, () => {
      diag(`received ${sig} (running="${currentTest}", lastFinished="${lastFinishedTest}")`);
      // Let the default behavior (exit) happen.
      process.exit(128);
    });
  } catch (_) {
    // ignore
  }
}

// Mocha root hooks — only registered if mocha picks up this file via --require.
// beforeEach sets the running pointer so a mid-test kill is attributable to a
// specific test, not just the previous one that successfully finished.
export const mochaHooks = {
  beforeEach(this: any) {
    if (this.currentTest) {
      currentTest = this.currentTest.fullTitle();
    }
  },
  afterEach(this: any) {
    if (this.currentTest) {
      lastFinishedTest = this.currentTest.fullTitle();
      currentTest = '<no test running>';
    }
  },
};
