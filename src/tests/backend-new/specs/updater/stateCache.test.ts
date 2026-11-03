import {describe, expect, it, vi} from 'vitest';
import {createStateCache} from '../../../../node/updater/stateCache';
import type {UpdateState} from '../../../../node/updater/types';

const stateWith = (status: string) => ({execution: {status}, lastResult: null, bootCount: 0}) as unknown as UpdateState;

describe('update state cache', () => {
  it('loads once and then serves the cached copy', async () => {
    const load = vi.fn(async () => stateWith('idle'));
    const save = vi.fn(async () => {});
    const cache = createStateCache({load, save});

    await cache.get();
    await cache.get();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves the saved state instead of the stale copy', async () => {
    // #8412: boot left the cache on pending-verification, the health check then
    // wrote `verified`, and the next poll persisted the stale copy over it.
    const load = vi.fn(async () => stateWith('pending-verification'));
    const save = vi.fn(async () => {});
    const cache = createStateCache({load, save});

    await cache.get();
    const verified = stateWith('verified');
    await cache.save(verified);

    await expect(cache.get()).resolves.toBe(verified);
    expect(save).toHaveBeenCalledWith(verified);
  });
});
