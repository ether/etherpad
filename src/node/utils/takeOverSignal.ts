'use strict';

/**
 * Makes `listener` the only listener for `signal`, removing any others (each removed listener is
 * passed to `onRemove` first, e.g. for logging).
 *
 * The new listener is added BEFORE the old ones are removed. If the listener count dropped to
 * zero in between, Node would close the underlying libuv signal handle and a signal that has
 * been caught but not yet dispatched (because the event loop is busy with synchronous work, as
 * it is during startup) would be silently dropped. See
 * https://github.com/ether/etherpad/issues/8421.
 */
export const takeOverSignal = (
    signal: NodeJS.Signals,
    listener: (...args: any[]) => any,
    onRemove: (signal: NodeJS.Signals, listener: (...args: any[]) => any) => void =
      (s, l) => { process.off(s, l); },
) => {
  if (!process.listeners(signal).includes(listener)) process.on(signal, listener);
  for (const other of process.listeners(signal)) {
    if (other !== listener) onRemove(signal, other as (...args: any[]) => any);
  }
  // Drop duplicate registrations of `listener` so it runs once per signal. process.off() removes
  // one registration at a time, so at least one always remains.
  while (process.listeners(signal).filter((l) => l === listener).length > 1) {
    process.off(signal, listener);
  }
};
