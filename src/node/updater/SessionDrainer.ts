/**
 * Coordinates the pre-restart drain: refuses new pad connections, broadcasts
 * "system message" announcements at T-60 / T-30 / T-10, and resolves at T=0
 * so the executor can take over.
 *
 * Per docs/superpowers/specs/2026-04-25-auto-update-design.md (section
 * "Active sessions"). 60s default; configurable via `updates.drainSeconds`.
 */

let acceptingConnections = true;

export const isAcceptingConnections = (): boolean => acceptingConnections;

/** Test-only: reset the module-level flag between tests. */
export const _resetForTests = (): void => { acceptingConnections = true; };

export type DrainBroadcastKey =
  | 'update.drain.t60'
  | 'update.drain.t30'
  | 'update.drain.t10';

export interface DrainerOpts {
  drainSeconds: number;
  /** Called for every announcement; values carries timing data the i18n string can interpolate. */
  broadcast: (i18nKey: DrainBroadcastKey, values: Record<string, unknown>) => void;
}

export interface Drainer {
  start: () => Promise<{outcome: 'completed' | 'cancelled'}>;
  cancel: () => void;
}

export const createDrainer = ({drainSeconds, broadcast}: DrainerOpts): Drainer => {
  const timers: NodeJS.Timeout[] = [];
  let resolveDone: ((r: {outcome: 'completed' | 'cancelled'}) => void) | null = null;
  let cancelled = false;
  let started = false;

  const fire = (key: DrainBroadcastKey, secondsRemaining: number) => {
    if (cancelled) return;
    broadcast(key, {seconds: secondsRemaining});
  };

  const start = (): Promise<{outcome: 'completed' | 'cancelled'}> => {
    if (started) return Promise.reject(new Error('drainer already started'));
    started = true;
    acceptingConnections = false;
    return new Promise((resolve) => {
      resolveDone = resolve;
      const ms = drainSeconds * 1000;
      // The opening announcement reports the actual drain length rather than a
      // hardcoded 60, so a configured drainSeconds of e.g. 30 says "30 seconds".
      // i18n key is still update.drain.t60 — that's the "start of drain" key in
      // the locale file; the {{seconds}} placeholder carries the real value.
      fire('update.drain.t60', drainSeconds);
      // Only schedule T-30 / T-10 when the configured window can actually
      // honour them. Firing a "30 seconds" message at zero remaining (because
      // ms - 30_000 < 0) is misleading; admins picking a short drainSeconds
      // get fewer announcements but each carries an accurate countdown.
      if (drainSeconds > 30) {
        timers.push(setTimeout(() => fire('update.drain.t30', 30), ms - 30_000));
      }
      if (drainSeconds > 10) {
        timers.push(setTimeout(() => fire('update.drain.t10', 10), ms - 10_000));
      }
      timers.push(setTimeout(() => {
        if (cancelled) return;
        // Restore the gate as soon as the drain window closes. The executor
        // takes over from here and the supervisor restart wipes module state
        // anyway; if the executor throws and the process keeps running, we
        // want join handshakes to recover rather than stay wedged.
        // The lock + state.execution.status guarantee no fresh apply can race.
        acceptingConnections = true;
        resolveDone?.({outcome: 'completed'});
        resolveDone = null;
      }, ms));
    });
  };

  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
    acceptingConnections = true;
    resolveDone?.({outcome: 'cancelled'});
    resolveDone = null;
  };

  return {start, cancel};
};
