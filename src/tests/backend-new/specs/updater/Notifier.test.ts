import {describe, it, expect} from 'vitest';
import {decideEmails, NotifierInput} from '../../../../node/updater/Notifier';
import {EMPTY_STATE} from '../../../../node/updater/types';

const base: NotifierInput = {
  adminEmail: 'admin@example.com',
  current: '2.0.0',
  latest: '2.7.2',
  latestTag: 'v2.7.2',
  vulnerableBelow: [],
  isVulnerable: false,
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

  it('emits vulnerable email on first detection', () => {
    const r = decideEmails({...base, isVulnerable: true});
    expect(r.toSend.map(e => e.kind)).toEqual(['vulnerable']);
    expect(r.newState.vulnerableAt).toBe('2026-04-25T12:00:00.000Z');
  });

  it('does not re-emit vulnerable within 7 days', () => {
    const r = decideEmails({
      ...base,
      isVulnerable: true,
      state: {...base.state, vulnerableAt: '2026-04-22T12:00:00.000Z'},
    });
    expect(r.toSend).toEqual([]);
  });

  it('re-emits vulnerable after 7 days', () => {
    const r = decideEmails({
      ...base,
      isVulnerable: true,
      state: {...base.state, vulnerableAt: '2026-04-15T12:00:00.000Z'},
    });
    expect(r.toSend.map(e => e.kind)).toEqual(['vulnerable']);
  });

  it('emits new-release-while-vulnerable when latest tag changes', () => {
    const r = decideEmails({
      ...base,
      isVulnerable: true,
      state: {...base.state, vulnerableAt: '2026-04-25T11:59:00.000Z', vulnerableNewReleaseTag: 'v2.7.1'},
    });
    expect(r.toSend.map(e => e.kind)).toEqual(['vulnerable-new-release']);
  });

  it('vulnerable wins over severe in the same tick', () => {
    const r = decideEmails({...base, isSevere: true, isVulnerable: true});
    expect(r.toSend.map(e => e.kind)).toEqual(['vulnerable']);
  });
});
