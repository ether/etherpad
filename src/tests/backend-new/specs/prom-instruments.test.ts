// Smoke test for the Prometheus instruments added for #7756. Verifies the
// recording helpers actually move the underlying metrics so the load-test
// harness can rely on them.

import {describe, it, expect, beforeEach} from 'vitest';
import {
  recordChangesetApply,
  recordSocketEmit,
  changesetApplyDuration,
  socketEmitsTotal,
} from '../../../node/prom-instruments';

beforeEach(() => {
  socketEmitsTotal.reset();
  changesetApplyDuration.reset();
});

describe('recordSocketEmit', () => {
  it('increments etherpad_socket_emits_total keyed by message type', async () => {
    recordSocketEmit('NEW_CHANGES');
    recordSocketEmit('NEW_CHANGES');
    recordSocketEmit('CHAT_MESSAGE');
    const values = await socketEmitsTotal.get();
    const byType: Record<string, number> = {};
    for (const v of values.values) byType[v.labels.type as string] = v.value;
    expect(byType['NEW_CHANGES']).toBe(2);
    expect(byType['CHAT_MESSAGE']).toBe(1);
  });

  it('falls back to "unknown" when type is missing', async () => {
    recordSocketEmit(undefined);
    const values = await socketEmitsTotal.get();
    expect(values.values.some((v) => v.labels.type === 'unknown')).toBe(true);
  });
});

describe('recordChangesetApply', () => {
  it('observes a duration in etherpad_changeset_apply_duration_seconds', async () => {
    const end = recordChangesetApply();
    await new Promise((r) => setTimeout(r, 5));
    end();
    const values = await changesetApplyDuration.get();
    // Histogram exposes `_sum` and `_count` rows. We only need to confirm count > 0.
    const countRow = values.values.find((v) => v.metricName === 'etherpad_changeset_apply_duration_seconds_count');
    expect(countRow?.value).toBeGreaterThan(0);
  });
});
