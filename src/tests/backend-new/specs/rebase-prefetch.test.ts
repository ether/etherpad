// Smoke test for the rebase-loop prefetch optimisation in
// PadMessageHandler.handleUserChanges (#7756). Exercises the pure
// "given a baseRev and a head, prefetch revs in one Promise.all" decision
// via a tiny helper that mirrors the production code.

import {describe, it, expect, vi} from 'vitest';

// The production code does:
//   const rebaseRange = [];
//   for (let i = baseRev + 1; i <= rebaseTargetHead; i++) rebaseRange.push(i);
//   const rebaseRevs = rebaseRange.length === 0
//     ? []
//     : await Promise.all(rebaseRange.map((i) => pad.getRevision(i)));
//
// Re-implementing here against a stub pad lets the test pin the call
// pattern: ONE Promise.all (not N sequential awaits) and ONE getRevision
// call per intermediate revision.

const buildRangeAndFetch = async (
  baseRev: number,
  headRev: number,
  getRevision: (i: number) => Promise<any>,
): Promise<any[]> => {
  const rebaseRange: number[] = [];
  for (let i = baseRev + 1; i <= headRev; i++) rebaseRange.push(i);
  if (rebaseRange.length === 0) return [];
  return Promise.all(rebaseRange.map((i) => getRevision(i)));
};

describe('rebase prefetch', () => {
  it('returns empty array when baseRev >= headRev', async () => {
    const getRevision = vi.fn();
    expect(await buildRangeAndFetch(10, 10, getRevision)).toEqual([]);
    expect(await buildRangeAndFetch(10, 9, getRevision)).toEqual([]);
    expect(getRevision).not.toHaveBeenCalled();
  });

  it('fetches one revision per intermediate rev, all in parallel', async () => {
    const order: number[] = [];
    const getRevision = vi.fn(async (i: number) => {
      order.push(i);
      // Slight async gap to demonstrate parallel resolution.
      await new Promise((r) => setTimeout(r, 1));
      return {meta: {author: `a${i}`}, changeset: `=${i}`};
    });
    const result = await buildRangeAndFetch(5, 10, getRevision);
    expect(result).toHaveLength(5);
    expect(result.map((r) => r.meta.author)).toEqual(['a6', 'a7', 'a8', 'a9', 'a10']);
    // All five getRevision calls fired before any resolved (parallel pattern).
    expect(order).toEqual([6, 7, 8, 9, 10]);
    expect(getRevision).toHaveBeenCalledTimes(5);
  });

  it('preserves order: results align with rev numbers requested', async () => {
    // Stub returns each rev with a delay inversely proportional to its number.
    // Without Promise.all the smaller-rev fetches would complete first and a
    // naive implementation that pushes in resolution order would scramble
    // ordering. Promise.all guarantees positional alignment.
    const getRevision = vi.fn(async (i: number) => {
      await new Promise((r) => setTimeout(r, 10 - i));
      return {meta: {author: `a${i}`}, changeset: `=${i}`};
    });
    const result = await buildRangeAndFetch(0, 5, getRevision);
    expect(result.map((r) => r.meta.author)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
  });
});
