import {describe, it, expect} from 'vitest';
import {evaluatePolicy} from '../../../../node/updater/UpdatePolicy';
import {InstallMethod, Tier} from '../../../../node/updater/types';

const baseInput = {
  installMethod: 'git' as Exclude<InstallMethod, 'auto'>,
  tier: 'manual' as Tier,
  current: '2.7.1',
  latest: '2.7.2',
};

describe('evaluatePolicy', () => {
  it('off tier denies everything', () => {
    const r = evaluatePolicy({...baseInput, tier: 'off'});
    expect(r).toEqual({canNotify: false, canManual: false, canAuto: false, canAutonomous: false, reason: 'tier-off'});
  });

  it('notify tier allows only notify', () => {
    const r = evaluatePolicy({...baseInput, tier: 'notify'});
    expect(r.canNotify).toBe(true);
    expect(r.canManual).toBe(false);
    expect(r.canAuto).toBe(false);
    expect(r.canAutonomous).toBe(false);
  });

  it('manual tier allows notify+manual on git', () => {
    const r = evaluatePolicy({...baseInput, tier: 'manual'});
    expect(r.canManual).toBe(true);
    expect(r.canAuto).toBe(false);
  });

  it('manual tier denies manual on docker', () => {
    const r = evaluatePolicy({...baseInput, tier: 'manual', installMethod: 'docker'});
    expect(r.canNotify).toBe(true);
    expect(r.canManual).toBe(false);
    expect(r.reason).toBe('install-method-not-writable');
  });

  it('autonomous tier allows everything on git', () => {
    const r = evaluatePolicy({...baseInput, tier: 'autonomous'});
    expect(r).toEqual({canNotify: true, canManual: true, canAuto: true, canAutonomous: true, reason: 'ok'});
  });

  it('autonomous on managed install denies write tiers', () => {
    const r = evaluatePolicy({...baseInput, tier: 'autonomous', installMethod: 'managed'});
    expect(r.canNotify).toBe(true);
    expect(r.canManual).toBe(false);
    expect(r.canAuto).toBe(false);
    expect(r.canAutonomous).toBe(false);
  });

  it('current === latest denies all (nothing to do)', () => {
    const r = evaluatePolicy({...baseInput, tier: 'autonomous', current: '2.7.2', latest: '2.7.2'});
    expect(r.canNotify).toBe(false);
    expect(r.canManual).toBe(false);
    expect(r.reason).toBe('up-to-date');
  });

  it('current > latest (dev build) denies all', () => {
    const r = evaluatePolicy({...baseInput, tier: 'autonomous', current: '3.0.0', latest: '2.7.2'});
    expect(r.canNotify).toBe(false);
    expect(r.reason).toBe('up-to-date');
  });
});
