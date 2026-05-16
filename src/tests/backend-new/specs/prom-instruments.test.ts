// Smoke test for the Prometheus instruments added for #7756. Verifies the
// recording helpers actually move the underlying metrics so the load-test
// harness can rely on them, AND that the settings.scalingDiveMetrics flag
// gates everything off when disabled.

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import settings from '../../../node/utils/Settings.js';
import {
  recordChangesetApply,
  recordSocketEmit,
  changesetApplyDuration,
  socketEmitsTotal,
} from '../../../node/prom-instruments.js';

const originalFlag = settings.scalingDiveMetrics;

beforeEach(() => {
  socketEmitsTotal.reset();
  changesetApplyDuration.reset();
  settings.scalingDiveMetrics = true;
});

afterEach(() => { settings.scalingDiveMetrics = originalFlag; });

describe('recordSocketEmit (flag enabled)', () => {
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

  it('buckets unknown / user-supplied label values as "other" to keep cardinality bounded', async () => {
    recordSocketEmit(undefined);
    recordSocketEmit('attacker-supplied-string-1');
    recordSocketEmit('attacker-supplied-string-2');
    const values = await socketEmitsTotal.get();
    const byType: Record<string, number> = {};
    for (const v of values.values) byType[v.labels.type as string] = v.value;
    expect(byType['other']).toBe(3);
    // No labels for the attacker strings — proves the allowlist is enforced.
    expect(Object.keys(byType)).not.toContain('attacker-supplied-string-1');
    expect(Object.keys(byType)).not.toContain('attacker-supplied-string-2');
  });
});

describe('recordChangesetApply (flag enabled)', () => {
  it('observes a duration in etherpad_changeset_apply_duration_seconds', async () => {
    const end = recordChangesetApply();
    await new Promise((r) => setTimeout(r, 5));
    end();
    const values = await changesetApplyDuration.get();
    const countRow = values.values.find((v) => v.metricName === 'etherpad_changeset_apply_duration_seconds_count');
    expect(countRow?.value).toBeGreaterThan(0);
  });
});

describe('feature flag (disabled by default)', () => {
  beforeEach(() => { settings.scalingDiveMetrics = false; });

  it('recordSocketEmit is a no-op', async () => {
    recordSocketEmit('NEW_CHANGES');
    const values = await socketEmitsTotal.get();
    expect(values.values.length).toBe(0);
  });

  it('recordChangesetApply returns a no-op stopper that does not observe', async () => {
    const end = recordChangesetApply();
    end();
    const values = await changesetApplyDuration.get();
    const countRow = values.values.find((v) => v.metricName === 'etherpad_changeset_apply_duration_seconds_count');
    expect(countRow?.value ?? 0).toBe(0);
  });
});
