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
      // T-60 announcement fires at start; T-30 and T-10 are scheduled at offsets.
      // Drain windows shorter than 30s collapse the early timers to "fire ASAP".
      fire('update.drain.t60', drainSeconds);
      timers.push(setTimeout(() => fire('update.drain.t30', 30), Math.max(0, ms - 30_000)));
      timers.push(setTimeout(() => fire('update.drain.t10', 10), Math.max(0, ms - 10_000)));
      timers.push(setTimeout(() => {
        if (cancelled) return;
        // Don't restore acceptingConnections — the executor is about to exit 75
        // and the supervisor restart will reset module state. Leaving the flag
        // off until exit means stragglers can't slip in between drain end and
        // exit().
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
