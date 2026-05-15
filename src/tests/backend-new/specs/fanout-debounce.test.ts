// Unit coverage for the per-pad fan-out debounce (#7756 lever 3).
// With debounce > 0, rapid scheduleFanout calls coalesce into a single
// fanout invocation per pad per debounce window.

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import settings from '../../../node/utils/Settings';
import {scheduleFanout, _state, setErrorHandler, type FanoutCallback} from '../../../node/handler/FanoutScheduler';

describe('fanout debounce', () => {
  const originalDebounce = settings.fanoutDebounceMs;
  let calls: string[];
  let fanout: FanoutCallback;

  beforeEach(() => {
    vi.useFakeTimers();
    _state.pendingFanouts.clear();
    calls = [];
    fanout = async (padId) => { calls.push(padId); };
    setErrorHandler(() => {/* swallow in tests */});
  });

  afterEach(() => {
    vi.useRealTimers();
    settings.fanoutDebounceMs = originalDebounce;
  });

  it('with debounce=0 fires the fanout synchronously per call', async () => {
    settings.fanoutDebounceMs = 0;
    scheduleFanout('pad-a', fanout);
    scheduleFanout('pad-a', fanout);
    scheduleFanout('pad-a', fanout);
    await vi.runAllTimersAsync();
    expect(calls).toEqual(['pad-a', 'pad-a', 'pad-a']);
    expect(_state.pendingFanouts.size).toBe(0);
  });

  it('with debounce>0 coalesces N rapid calls into a single fanout call', async () => {
    settings.fanoutDebounceMs = 50;
    for (let i = 0; i < 10; i++) scheduleFanout('pad-a', fanout);
    expect(calls).toEqual([]);
    expect(_state.pendingFanouts.size).toBe(1);
    await vi.advanceTimersByTimeAsync(60);
    expect(calls).toEqual(['pad-a']);
    expect(_state.pendingFanouts.size).toBe(0);
  });

  it('debounces independently per pad', async () => {
    settings.fanoutDebounceMs = 50;
    scheduleFanout('pad-a', fanout);
    scheduleFanout('pad-b', fanout);
    scheduleFanout('pad-a', fanout);
    expect(_state.pendingFanouts.size).toBe(2);
    await vi.advanceTimersByTimeAsync(60);
    expect(calls.sort()).toEqual(['pad-a', 'pad-b']);
  });

  it('after the window fires, a new schedule starts a fresh window', async () => {
    settings.fanoutDebounceMs = 50;
    scheduleFanout('pad-a', fanout);
    await vi.advanceTimersByTimeAsync(60);
    expect(calls).toEqual(['pad-a']);
    scheduleFanout('pad-a', fanout);
    expect(_state.pendingFanouts.size).toBe(1);
    await vi.advanceTimersByTimeAsync(60);
    expect(calls).toEqual(['pad-a', 'pad-a']);
  });

  it('routes fanout errors through setErrorHandler', async () => {
    settings.fanoutDebounceMs = 0;
    const errors: Array<{padId: string; err: unknown}> = [];
    setErrorHandler((padId, err) => { errors.push({padId, err}); });
    scheduleFanout('pad-x', async () => { throw new Error('boom'); });
    await vi.runAllTimersAsync();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.padId).toBe('pad-x');
    expect((errors[0]!.err as Error).message).toBe('boom');
  });
});
