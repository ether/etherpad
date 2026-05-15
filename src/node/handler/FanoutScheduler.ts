// Per-pad fan-out scheduler — debounce wrapper for #7756 lever 3.
//
// When `settings.fanoutDebounceMs <= 0` (default), fan-out fires immediately
// — legacy behaviour. When > 0, rapid scheduleFanout(pad) calls coalesce
// into a single fan-out per pad per debounce window.
//
// Lives in its own module rather than inside PadMessageHandler so the
// scheduling logic can be unit-tested without pulling in the full pad / DB
// / socket.io stack.

import settings from '../utils/Settings';

export type FanoutCallback = (padId: string) => Promise<void>;

const pendingFanouts = new Map<string, NodeJS.Timeout>();
let onError: (padId: string, err: unknown) => void = (padId, err) => {
  // Default error sink: re-throw on the next tick so it shows up in the log.
  setImmediate(() => { throw err; });
};

/** Override the error handler. PadMessageHandler installs one that uses messageLogger. */
export const setErrorHandler = (fn: (padId: string, err: unknown) => void): void => {
  onError = fn;
};

/** Schedule a fan-out for the given pad. */
export const scheduleFanout = (padId: string, fanout: FanoutCallback): void => {
  const debounceMs = settings.fanoutDebounceMs ?? 0;
  if (debounceMs <= 0) {
    void fanout(padId).catch((err) => onError(padId, err));
    return;
  }
  if (pendingFanouts.has(padId)) return;
  const t = setTimeout(() => {
    pendingFanouts.delete(padId);
    void fanout(padId).catch((err) => onError(padId, err));
  }, debounceMs);
  if (typeof (t as {unref?: () => void}).unref === 'function') (t as {unref: () => void}).unref();
  pendingFanouts.set(padId, t);
};

/** Test helper. */
export const _state = {pendingFanouts};
