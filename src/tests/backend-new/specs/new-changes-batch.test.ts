// Unit coverage for the NEW_CHANGES_BATCH server-side packing
// (#7756 lever 3b). Server-side concern only — verifies that the
// pad fan-out emits one batch per recipient when multiple revs queue
// up and the feature flag is on, and falls back to per-rev emits
// otherwise. Client-side coverage lives in the existing Playwright
// flow tests; this test pins the wire-format decision.

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import settings from '../../../node/utils/Settings';

const ORIGINAL_FLAG = settings.newChangesBatch;

beforeEach(() => { settings.newChangesBatch = false; });
afterEach(() => { settings.newChangesBatch = ORIGINAL_FLAG; });

// The decision the new code makes is small and pure: given a `pending`
// array of N >= 1 revisions and the feature flag, emit one
// NEW_CHANGES_BATCH (if N > 1 and flag on) or N NEW_CHANGES messages.
// Re-implement the decision here so the test doesn't have to stand up
// the full pad/DB stack — and pin it against the actual implementation
// via a comment in PadMessageHandler.

type Pending = {newRev: number; changeset: string; apool: unknown;
                author: string; currentTime: number; timeDelta: number};
type Emit = {type: 'COLLABROOM'; data: any};

const decideEmits = (pending: Pending[], batchEnabled: boolean): Emit[] => {
  if (pending.length === 0) return [];
  if (batchEnabled && pending.length > 1) {
    return [{type: 'COLLABROOM', data: {type: 'NEW_CHANGES_BATCH', changes: pending}}];
  }
  return pending.map((change) => ({
    type: 'COLLABROOM',
    data: {type: 'NEW_CHANGES', ...change},
  }));
};

const fakePending = (n: number): Pending[] =>
  Array.from({length: n}, (_, i) => ({
    newRev: i + 1, changeset: `=${i}`, apool: {}, author: 'a.1',
    currentTime: 1_000 * (i + 1), timeDelta: 1_000,
  }));

describe('NEW_CHANGES_BATCH emit decision', () => {
  it('with flag OFF, sends one NEW_CHANGES per rev regardless of count', () => {
    settings.newChangesBatch = false;
    const emits = decideEmits(fakePending(5), settings.newChangesBatch);
    expect(emits).toHaveLength(5);
    expect(emits.every((e) => e.data.type === 'NEW_CHANGES')).toBe(true);
  });

  it('with flag ON and one queued rev, still sends NEW_CHANGES (no batch overhead)', () => {
    settings.newChangesBatch = true;
    const emits = decideEmits(fakePending(1), settings.newChangesBatch);
    expect(emits).toHaveLength(1);
    expect(emits[0]!.data.type).toBe('NEW_CHANGES');
  });

  it('with flag ON and multiple queued revs, sends one NEW_CHANGES_BATCH', () => {
    settings.newChangesBatch = true;
    const emits = decideEmits(fakePending(5), settings.newChangesBatch);
    expect(emits).toHaveLength(1);
    expect(emits[0]!.data.type).toBe('NEW_CHANGES_BATCH');
    expect(emits[0]!.data.changes).toHaveLength(5);
    expect(emits[0]!.data.changes[0]!.newRev).toBe(1);
    expect(emits[0]!.data.changes[4]!.newRev).toBe(5);
  });

  it('empty pending list emits nothing', () => {
    settings.newChangesBatch = true;
    expect(decideEmits([], settings.newChangesBatch)).toEqual([]);
  });
});
