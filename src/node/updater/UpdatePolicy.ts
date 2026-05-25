import {compareSemver} from './versionCompare.js';
import {parseWindow} from './MaintenanceWindow.js';
import {InstallMethod, MaintenanceWindow, PolicyResult, Tier} from './types.js';

// For PR 1 (notify only) the writable list contains only 'git'.
// PR 2+ may add 'npm' here as the executor learns to handle that path.
const WRITABLE_METHODS: ReadonlySet<Exclude<InstallMethod, 'auto'>> = new Set(['git']);

export interface PolicyInput {
  installMethod: Exclude<InstallMethod, 'auto'>;
  tier: Tier;
  current: string;
  latest: string;
  /**
   * Optional execution-status hint. Only `rollback-failed` materially changes
   * policy: while it's set, canAuto / canAutonomous are denied (an admin must
   * acknowledge first). canManual stays on because clicking Apply *is* the
   * intervention the terminal state requires.
   */
  executionStatus?: string;
  /**
   * Configured maintenance window from `updates.maintenanceWindow`. Tier 4
   * requires a non-null, parse-valid window. When null or malformed,
   * canAutonomous degrades to false with a reason of
   * `maintenance-window-missing` / `maintenance-window-invalid`; the other
   * permissions still resolve as if tier were `auto`.
   */
  maintenanceWindow?: MaintenanceWindow | unknown | null;
}

/**
 * Decide which update tiers are allowed under the given (installMethod, tier,
 * current, latest, executionStatus, maintenanceWindow). Pure function — no I/O.
 * The single source of truth for "what's allowed in this environment."
 *
 * `reason` is one of:
 *   'tier-off' | 'up-to-date' | 'install-method-not-writable'
 *   | 'rollback-failed-terminal'
 *   | 'maintenance-window-missing' | 'maintenance-window-invalid'
 *   | 'ok'.
 */
export const evaluatePolicy = ({
  installMethod, tier, current, latest, executionStatus, maintenanceWindow,
}: PolicyInput): PolicyResult => {
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

  const terminal = executionStatus === 'rollback-failed';
  const canManual = tier === 'manual' || tier === 'auto' || tier === 'autonomous';
  const canAuto = !terminal && (tier === 'auto' || tier === 'autonomous');

  let canAutonomous = false;
  let windowReason: string | null = null;
  if (!terminal && tier === 'autonomous') {
    if (maintenanceWindow == null) {
      windowReason = 'maintenance-window-missing';
    } else if (parseWindow(maintenanceWindow) == null) {
      windowReason = 'maintenance-window-invalid';
    } else {
      canAutonomous = true;
    }
  }

  const reason = terminal
    ? 'rollback-failed-terminal'
    : (windowReason ?? 'ok');

  return {canNotify, canManual, canAuto, canAutonomous, reason};
};
