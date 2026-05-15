// Unit coverage for the per-pad fan-out debounce (#7756 lever 3).
// With debounce > 0, rapid scheduleFanout calls coalesce into a single
// fanout invocation per pad per debounce window. Concurrent fan-outs for
// the same pad are prevented by the running/dirty state.

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import settings from '../../../node/utils/Settings';
import {
  scheduleFanout,
  _state,
  setErrorHandler,
  resetErrorHandler,
  type FanoutCallback,
} from '../../../node/handler/FanoutScheduler';

describe('fanout debounce', () => {
  const originalDebounce = settings.fanoutDebounceMs;
  let calls: string[];
  let fanout: FanoutCallback;

  beforeEach(() => {
    vi.useFakeTimers();
    _state.clear();
    calls = [];
    fanout = async (padId) => { calls.push(padId); };
    setErrorHandler(() => {/* swallow in tests */});
    settings.fanoutDebounceMs = 50;
  });

  afterEach(() => {
    vi.useRealTimers();
    settings.fanoutDebounceMs = originalDebounce;
    _state.clear();
    resetErrorHandler();
  });

  it('coalesces N rapid calls into a single fanout call within one window', async () => {
    for (let i = 0; i < 10; i++) scheduleFanout('pad-a', fanout);
    expect(calls).toEqual([]);
    expect(_state.size).toBe(1);
    await vi.advanceTimersByTimeAsync(60);
    expect(calls).toEqual(['pad-a']);
    expect(_state.size).toBe(0);
  });

  it('debounces independently per pad', async () => {
    scheduleFanout('pad-a', fanout);
    scheduleFanout('pad-b', fanout);
    scheduleFanout('pad-a', fanout);
    expect(_state.size).toBe(2);
    await vi.advanceTimersByTimeAsync(60);
    expect(calls.sort()).toEqual(['pad-a', 'pad-b']);
    expect(_state.size).toBe(0);
  });

  it('after the window fires, a new schedule starts a fresh window', async () => {
    scheduleFanout('pad-a', fanout);
    await vi.advanceTimersByTimeAsync(60);
    expect(calls).toEqual(['pad-a']);
    scheduleFanout('pad-a', fanout);
    expect(_state.size).toBe(1);
    await vi.advanceTimersByTimeAsync(60);
    expect(calls).toEqual(['pad-a', 'pad-a']);
  });

  it('schedules arriving during an in-flight fan-out get a follow-up pass', async () => {
    // Slow fanout that yields so we can interleave a schedule mid-flight.
    let release: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fanout = async (padId) => {
      calls.push(`start-${padId}`);
      await gate;
      calls.push(`end-${padId}`);
    };
    scheduleFanout('pad-a', fanout);
    await vi.advanceTimersByTimeAsync(60); // window fires, callback awaits gate
    expect(calls).toEqual(['start-pad-a']);
    // A new commit lands while the fan-out is awaiting.
    scheduleFanout('pad-a', fanout);
    expect(_state.get('pad-a')?.dirty).toBe(true);
    // Release the running fan-out; the dirty flag should trigger another window.
    release!();
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(60);
    expect(calls).toEqual(['start-pad-a', 'end-pad-a', 'start-pad-a', 'end-pad-a']);
    expect(_state.size).toBe(0);
  });

  it('routes fanout errors through setErrorHandler', async () => {
    const errors: Array<{padId: string; err: unknown}> = [];
    setErrorHandler((padId, err) => { errors.push({padId, err}); });
    scheduleFanout('pad-x', async () => { throw new Error('boom'); });
    await vi.advanceTimersByTimeAsync(60);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.padId).toBe('pad-x');
    expect((errors[0]!.err as Error).message).toBe('boom');
  });
});
