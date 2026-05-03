import {compareSemver} from './versionCompare';
import {InstallMethod, PolicyResult, Tier} from './types';

// For PR 1 (notify only) the writable list contains only 'git'.
// PR 2+ may add 'npm' here as the executor learns to handle that path.
const WRITABLE_METHODS: ReadonlySet<Exclude<InstallMethod, 'auto'>> = new Set(['git']);

export interface PolicyInput {
  installMethod: Exclude<InstallMethod, 'auto'>;
  tier: Tier;
  current: string;
  latest: string;
}

/**
 * Decide which update tiers are allowed under the given (installMethod, tier, current, latest).
 * Pure function — no I/O. The single source of truth for "what's allowed in this environment."
 * `reason` is one of: 'tier-off' | 'up-to-date' | 'install-method-not-writable' | 'ok'.
 */
export const evaluatePolicy = ({installMethod, tier, current, latest}: PolicyInput): PolicyResult => {
  if (tier === 'off') {
    return {canNotify: false, canManual: false, canAuto: false, canAutonomous: false, reason: 'tier-off'};
  }
  if (compareSemver(current, latest) >= 0) {
    return {canNotify: false, canManual: false, canAuto: false, canAutonomous: false, reason: 'up-to-date'};
  }

  const canNotify = true;
  const writable = WRITABLE_METHODS.has(installMethod);

  if (!writable) {
    return {canNotify, canManual: false, canAuto: false, canAutonomous: false, reason: 'install-method-not-writable'};
  }

  return {
    canNotify,
    canManual: tier === 'manual' || tier === 'auto' || tier === 'autonomous',
    canAuto: tier === 'auto' || tier === 'autonomous',
    canAutonomous: tier === 'autonomous',
    reason: 'ok',
  };
};
