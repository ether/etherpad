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

  it('restores isAcceptingConnections to true on drain completion', async () => {
    const drainer = createDrainer({drainSeconds: 60, broadcast: () => {}});
    const done = drainer.start();
    expect(isAcceptingConnections()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    // Restored at completion so a downstream throw doesn't wedge join handshakes.
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

  it('drainSeconds=15 skips t30 (window too short) but still fires t10', async () => {
    const seen: Array<{key: string; values: any}> = [];
    const drainer = createDrainer({
      drainSeconds: 15,
      broadcast: (key, values) => { seen.push({key, values}); },
    });
    const done = drainer.start();
    // Opening announcement reports the configured drain length, not a fixed 60.
    expect(seen).toEqual([{key: 'update.drain.t60', values: {seconds: 15}}]);
    // t30 is suppressed because reporting "30 seconds" would be wrong.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(seen.map((s) => s.key)).not.toContain('update.drain.t30');
    // t10 fires when 10 seconds remain (= 5s from start of a 15s drain).
    expect(seen.map((s) => s.key)).toContain('update.drain.t10');
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
  });

  it('drainSeconds=5 skips both t30 and t10', async () => {
    const seen: string[] = [];
    const drainer = createDrainer({
      drainSeconds: 5,
      broadcast: (key) => { seen.push(key); },
    });
    const done = drainer.start();
    expect(seen).toEqual(['update.drain.t60']);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    expect(seen).toEqual(['update.drain.t60']); // only the opening announcement
  });
});
