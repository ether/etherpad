// HistoricalAuthorDataCache pins the per-pad author-data cache used by
// PadMessageHandler.handleClientReady. The cache exists to coalesce the
// Promise.all(authors.map(getAuthor)) work across simultaneous CLIENT_READY
// handshakes — see ether/etherpad#7756.
//
// The helper takes pure functions as input (no DB, no Pad), so this test
// exercises the real production code path without standing up the full
// pad / DB stack.

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {HistoricalAuthorDataCache, type AuthorRecord} from '../../../node/db/HistoricalAuthorDataCache';

const makeCache = (ids: string[], fetcher: (id: string) => Promise<AuthorRecord | null | undefined>, ttlMs = 5_000, now = () => Date.now()) =>
  new HistoricalAuthorDataCache(() => ids, fetcher, ttlMs, now);

describe('HistoricalAuthorDataCache', () => {
  let getAuthorMock: ReturnType<typeof vi.fn<(id: string) => Promise<AuthorRecord | null>>>;

  beforeEach(() => {
    getAuthorMock = vi.fn(async (id: string) => ({name: `n-${id}`, colorId: `c-${id}`}));
  });

  it('returns one entry per author with {name, colorId}', async () => {
    const cache = makeCache(['a.1', 'a.2', 'a.3'], getAuthorMock);
    const data = await cache.get();
    expect(data).toEqual({
      'a.1': {name: 'n-a.1', colorId: 'c-a.1'},
      'a.2': {name: 'n-a.2', colorId: 'c-a.2'},
      'a.3': {name: 'n-a.3', colorId: 'c-a.3'},
    });
  });

  it('coalesces 50 simultaneous get() calls into 1 fetch per author', async () => {
    const cache = makeCache(['a.1', 'a.2', 'a.3'], getAuthorMock);
    const results = await Promise.all(Array.from({length: 50}, () => cache.get()));
    expect(results).toHaveLength(50);
    expect(getAuthorMock).toHaveBeenCalledTimes(3);
    for (const r of results) {
      expect(Object.keys(r).sort()).toEqual(['a.1', 'a.2', 'a.3']);
    }
  });

  it('refetches once the TTL expires', async () => {
    let clock = 0;
    const cache = makeCache(['a.1'], getAuthorMock, 5_000, () => clock);
    await cache.get();
    expect(getAuthorMock).toHaveBeenCalledTimes(1);
    clock = 4_000;
    await cache.get();
    expect(getAuthorMock).toHaveBeenCalledTimes(1);
    clock = 6_000;
    await cache.get();
    expect(getAuthorMock).toHaveBeenCalledTimes(2);
  });

  it('omits authors the fetcher returns falsy for', async () => {
    const fetcher = vi.fn(async (id: string) =>
      id === 'a.gone' ? null : {name: `n-${id}`, colorId: 'c'});
    const cache = makeCache(['a.1', 'a.gone', 'a.2'], fetcher);
    const data = await cache.get();
    expect(Object.keys(data).sort()).toEqual(['a.1', 'a.2']);
  });

  it('invalidate() forces the next call to refetch', async () => {
    const cache = makeCache(['a.1'], getAuthorMock);
    await cache.get();
    await cache.get();
    expect(getAuthorMock).toHaveBeenCalledTimes(1);
    cache.invalidate();
    await cache.get();
    expect(getAuthorMock).toHaveBeenCalledTimes(2);
  });

  it('a failed fetch clears the cache so the next call retries', async () => {
    let attempt = 0;
    const flakyFetcher = vi.fn(async (id: string) => {
      attempt++;
      if (attempt === 1) throw new Error('first attempt fails');
      return {name: `n-${id}`, colorId: 'c'};
    });
    const cache = makeCache(['a.1'], flakyFetcher);
    await expect(cache.get()).rejects.toThrow('first attempt fails');
    const data = await cache.get();
    expect(data).toEqual({'a.1': {name: 'n-a.1', colorId: 'c'}});
  });
});
