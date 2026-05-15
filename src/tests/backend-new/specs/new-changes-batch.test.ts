// Regression test for the NEW_CHANGES_BATCH wire-format decision
// (#7756 lever 3b). Imports the real implementation from
// PadMessageHandler so removing or breaking the production batching
// logic fails this test.

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import settings from '../../../node/utils/Settings';
import {buildNewChangesEmits, type NewChangesItem} from '../../../node/handler/NewChangesPacker';

const ORIGINAL_FLAG = settings.newChangesBatch;

beforeEach(() => { settings.newChangesBatch = false; });
afterEach(() => { settings.newChangesBatch = ORIGINAL_FLAG; });

const fakePending = (n: number): NewChangesItem[] =>
  Array.from({length: n}, (_, i) => ({
    newRev: i + 1, changeset: `=${i}`, apool: {}, author: 'a.1',
    currentTime: 1_000 * (i + 1), timeDelta: 1_000,
  }));

describe('buildNewChangesEmits', () => {
  it('flag OFF: one NEW_CHANGES per rev regardless of count', () => {
    const emits = buildNewChangesEmits(fakePending(5), false);
    expect(emits).toHaveLength(5);
    expect(emits.every((e) => e.data.type === 'NEW_CHANGES')).toBe(true);
  });

  it('flag ON, single rev: still NEW_CHANGES (no batch overhead for the steady state)', () => {
    const emits = buildNewChangesEmits(fakePending(1), true);
    expect(emits).toHaveLength(1);
    expect(emits[0]!.data.type).toBe('NEW_CHANGES');
  });

  it('flag ON, multiple revs: a single NEW_CHANGES_BATCH carrying all of them', () => {
    const emits = buildNewChangesEmits(fakePending(5), true);
    expect(emits).toHaveLength(1);
    expect(emits[0]!.data.type).toBe('NEW_CHANGES_BATCH');
    const batch = emits[0]!.data as {type: 'NEW_CHANGES_BATCH'; changes: NewChangesItem[]};
    expect(batch.changes).toHaveLength(5);
    expect(batch.changes[0]!.newRev).toBe(1);
    expect(batch.changes[4]!.newRev).toBe(5);
  });

  it('empty pending list emits nothing', () => {
    expect(buildNewChangesEmits([], true)).toEqual([]);
    expect(buildNewChangesEmits([], false)).toEqual([]);
  });
});
