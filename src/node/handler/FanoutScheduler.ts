// Per-pad fan-out scheduler — debounce wrapper for #7756 lever 3.
//
// When `settings.fanoutDebounceMs <= 0` the scheduler is bypassed entirely;
// PadMessageHandler.handleUserChanges awaits updatePadClients directly. When
// > 0, rapid scheduleFanout(padId, fn) calls coalesce into a single fanout
// invocation per pad per debounce window.
//
// Concurrency contract: a single pad has at most one in-flight fan-out at a
// time. If a new commit arrives while a fan-out is running, a "dirty" flag
// is set; when the running fan-out finishes it triggers a follow-up schedule
// so the late commit isn't missed.
//
// Lives in its own module rather than inside PadMessageHandler so the
// scheduling logic can be unit-tested without pulling in the full pad / DB
// / socket.io stack.

import settings from '../utils/Settings';

export type FanoutCallback = (padId: string) => Promise<void>;

type PadState = {
  /** setTimeout handle for the debounce window — set iff timer is pending. */
  timer?: NodeJS.Timeout;
  /** True while updatePadClients (or the test stub) is running for this pad. */
  running: boolean;
  /** A schedule arrived while running — re-schedule after the current run finishes. */
  dirty: boolean;
};

const state = new Map<string, PadState>();

const defaultErrorHandler = (_padId: string, err: unknown): void => {
  // Re-throw on the next tick so the error surfaces in the log stream.
  setImmediate(() => { throw err; });
};
let onError: (padId: string, err: unknown) => void = defaultErrorHandler;

/** Override the error handler. PadMessageHandler installs one that uses messageLogger. */
export const setErrorHandler = (fn: (padId: string, err: unknown) => void): void => {
  onError = fn;
};

/** Restore the default error handler (used by tests to avoid leaking state across files). */
export const resetErrorHandler = (): void => { onError = defaultErrorHandler; };

const fireWindow = async (padId: string, fanout: FanoutCallback): Promise<void> => {
  const s = state.get(padId);
  if (!s) return;
  s.timer = undefined;
  s.running = true;
  s.dirty = false;
  try {
    await fanout(padId);
  } catch (err) {
    onError(padId, err);
  } finally {
    s.running = false;
    if (s.dirty) {
      // A schedule arrived during the run; do another pass so that
      // late commits don't sit until the next user action.
      s.dirty = false;
      const debounceMs = settings.fanoutDebounceMs ?? 0;
      s.timer = setTimeout(() => { void fireWindow(padId, fanout); }, debounceMs);
      if (typeof (s.timer as {unref?: () => void}).unref === 'function') {
        (s.timer as {unref: () => void}).unref();
      }
    } else {
      state.delete(padId);
    }
  }
};

/** Schedule a fan-out for the given pad. Caller guarantees fanoutDebounceMs > 0. */
export const scheduleFanout = (padId: string, fanout: FanoutCallback): void => {
  const debounceMs = settings.fanoutDebounceMs ?? 0;
  let s = state.get(padId);
  if (!s) { s = {running: false, dirty: false}; state.set(padId, s); }
  if (s.running) {
    // Defer to follow-up after the current run.
    s.dirty = true;
    return;
  }
  if (s.timer !== undefined) {
    // Already scheduled in the current window.
    return;
  }
  s.timer = setTimeout(() => { void fireWindow(padId, fanout); }, debounceMs);
  if (typeof (s.timer as {unref?: () => void}).unref === 'function') {
    (s.timer as {unref: () => void}).unref();
  }
};

/** Test helper. */
export const _state = state;
