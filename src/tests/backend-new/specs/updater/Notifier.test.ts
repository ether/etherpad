import {describe, it, expect} from 'vitest';
import {decideEmails, decideOutcomeEmail, NotifierInput} from '../../../../node/updater/Notifier.js';
import {EMPTY_STATE} from '../../../../node/updater/types.js';

const base: NotifierInput = {
  adminEmail: 'admin@example.com',
  current: '2.0.0',
  latest: '2.7.2',
  latestTag: 'v2.7.2',
  isSevere: false,
  state: EMPTY_STATE.email,
  now: new Date('2026-04-25T12:00:00Z'),
};

describe('decideEmails', () => {
  it('emits no email if adminEmail is unset', () => {
    const r = decideEmails({...base, adminEmail: null, isSevere: true});
    expect(r.toSend).toEqual([]);
  });

  it('emits severe email on first detection', () => {
    const r = decideEmails({...base, isSevere: true});
    expect(r.toSend.map(e => e.kind)).toEqual(['severe']);
    expect(r.newState.severeAt).toBe('2026-04-25T12:00:00.000Z');
  });

  it('does not re-emit severe within 30 days', () => {
    const r = decideEmails({
      ...base,
      isSevere: true,
      state: {...base.state, severeAt: '2026-04-10T12:00:00.000Z'},
    });
    expect(r.toSend).toEqual([]);
  });

  it('re-emits severe after 30 days', () => {
    const r = decideEmails({
      ...base,
      isSevere: true,
      state: {...base.state, severeAt: '2026-03-20T12:00:00.000Z'},
    });
    expect(r.toSend.map(e => e.kind)).toEqual(['severe']);
  });

  it('emits no email when neither severe nor vulnerable', () => {
    const r = decideEmails({...base});
    expect(r.toSend).toEqual([]);
  });
});

describe('decideOutcomeEmail', () => {
  const failureBase = {
    adminEmail: 'ops@example.com',
    reason: 'pnpm install exit 1',
    targetTag: 'v2.7.6',
    currentVersion: '2.7.5',
    state: EMPTY_STATE.email,
  };

  it('does nothing when adminEmail is null', () => {
    const r = decideOutcomeEmail({...failureBase, adminEmail: null, outcome: 'rolled-back'});
    expect(r.toSend).toEqual([]);
    expect(r.newState).toBe(failureBase.state);
  });

  it('emits update-rolled-back on first failure for a tag', () => {
    const r = decideOutcomeEmail({...failureBase, outcome: 'rolled-back'});
    expect(r.toSend).toHaveLength(1);
    expect(r.toSend[0].kind).toBe('update-rolled-back');
    expect(r.toSend[0].subject).toContain('v2.7.6');
    expect(r.toSend[0].body).toContain('pnpm install exit 1');
    expect(r.toSend[0].body).toContain('2.7.5');
    expect(r.newState.lastFailureKey).toBe('rolled-back:v2.7.6');
  });

  it('emits update-preflight-failed for that outcome', () => {
    const r = decideOutcomeEmail({...failureBase, outcome: 'preflight-failed', reason: 'node-engine-mismatch: target requires Node >=26'});
    expect(r.toSend[0].kind).toBe('update-preflight-failed');
    expect(r.toSend[0].body).toContain('node-engine-mismatch');
    expect(r.newState.lastFailureKey).toBe('preflight-failed:v2.7.6');
  });

  it('emits update-rollback-failed on the terminal outcome', () => {
    const r = decideOutcomeEmail({...failureBase, outcome: 'rollback-failed', reason: 'restore checkout exit 128'});
    expect(r.toSend[0].kind).toBe('update-rollback-failed');
    expect(r.toSend[0].subject).toContain('manual intervention');
    expect(r.toSend[0].body).toContain('/admin/update/acknowledge');
  });

  it('dedupes the same outcome on the same tag (retry-loop guard)', () => {
    const first = decideOutcomeEmail({...failureBase, outcome: 'rolled-back'});
    const second = decideOutcomeEmail({
      ...failureBase, outcome: 'rolled-back', state: first.newState,
    });
    expect(second.toSend).toEqual([]);
    // newState pointer unchanged when dedup hit.
    expect(second.newState).toBe(first.newState);
  });

  it('re-emits when the outcome differs on the same tag', () => {
    const first = decideOutcomeEmail({...failureBase, outcome: 'preflight-failed'});
    const second = decideOutcomeEmail({
      ...failureBase, outcome: 'rolled-back', state: first.newState,
    });
    expect(second.toSend).toHaveLength(1);
    expect(second.newState.lastFailureKey).toBe('rolled-back:v2.7.6');
  });

  it('re-emits when the same outcome happens on a different tag', () => {
    const first = decideOutcomeEmail({...failureBase, outcome: 'rolled-back'});
    const second = decideOutcomeEmail({
      ...failureBase, targetTag: 'v2.7.7', outcome: 'rolled-back', state: first.newState,
    });
    expect(second.toSend).toHaveLength(1);
    expect(second.newState.lastFailureKey).toBe('rolled-back:v2.7.7');
  });

  it('rollback-failed always fires (overrides dedupe — terminal state matters more than spam)', () => {
    const first = decideOutcomeEmail({...failureBase, outcome: 'rollback-failed'});
    const second = decideOutcomeEmail({
      ...failureBase, outcome: 'rollback-failed', state: first.newState,
    });
    expect(second.toSend).toHaveLength(1);
  });
});
