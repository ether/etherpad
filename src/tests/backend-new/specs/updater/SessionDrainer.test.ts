import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {createDrainer, isAcceptingConnections, _resetForTests} from '../../../../node/updater/SessionDrainer';

describe('SessionDrainer', () => {
  beforeEach(() => { vi.useFakeTimers(); _resetForTests(); });
  afterEach(() => { vi.useRealTimers(); _resetForTests(); });

  it('emits T-60, T-30, T-10 in order and resolves at T=0', async () => {
    const broadcasts: string[] = [];
    const drainer = createDrainer({
      drainSeconds: 60,
      broadcast: (key) => { broadcasts.push(key); },
    });
    const done = drainer.start();
    expect(broadcasts).toEqual(['update.drain.t60']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(broadcasts).toEqual(['update.drain.t60', 'update.drain.t30']);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(broadcasts).toEqual(['update.drain.t60', 'update.drain.t30', 'update.drain.t10']);
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await done;
    expect(r).toEqual({outcome: 'completed'});
  });

  it('flips isAcceptingConnections to false during drain and back on cancel', () => {
    const drainer = createDrainer({drainSeconds: 60, broadcast: () => {}});
    expect(isAcceptingConnections()).toBe(true);
    drainer.start();
    expect(isAcceptingConnections()).toBe(false);
    drainer.cancel();
    expect(isAcceptingConnections()).toBe(true);
  });

  it('cancel before T=0 resolves start() promise as cancelled', async () => {
    const drainer = createDrainer({drainSeconds: 60, broadcast: () => {}});
    const done = drainer.start();
    await vi.advanceTimersByTimeAsync(20_000);
    drainer.cancel();
    const r = await done;
    expect(r).toEqual({outcome: 'cancelled'});
  });

  it('cancel does not fire any further broadcasts', async () => {
    const broadcasts: string[] = [];
    const drainer = createDrainer({
      drainSeconds: 60,
      broadcast: (key) => { broadcasts.push(key); },
    });
    drainer.start();
    expect(broadcasts).toEqual(['update.drain.t60']);
    drainer.cancel();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(broadcasts).toEqual(['update.drain.t60']);
  });

  it('passes seconds-remaining in broadcast values', async () => {
    const seen: Array<{key: string; values: any}> = [];
    const drainer = createDrainer({
      drainSeconds: 60,
      broadcast: (key, values) => { seen.push({key, values}); },
    });
    drainer.start();
    expect(seen[0]).toEqual({key: 'update.drain.t60', values: {seconds: 60}});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(seen[1]).toEqual({key: 'update.drain.t30', values: {seconds: 30}});
    await vi.advanceTimersByTimeAsync(20_000);
    expect(seen[2]).toEqual({key: 'update.drain.t10', values: {seconds: 10}});
  });

  it('drain shorter than 30s skips the t30 broadcast but still emits t10 and completes', async () => {
    const broadcasts: string[] = [];
    const drainer = createDrainer({
      drainSeconds: 15,
      broadcast: (key) => { broadcasts.push(key); },
    });
    const done = drainer.start();
    expect(broadcasts).toEqual(['update.drain.t60']);
    // t30 fires at max(0, 15-30)=0 i.e. immediately on next tick.
    await vi.advanceTimersByTimeAsync(0);
    expect(broadcasts).toContain('update.drain.t30');
    await vi.advanceTimersByTimeAsync(15_000);
    await done;
    expect(broadcasts.at(-1)).toBe('update.drain.t10');
  });
});
