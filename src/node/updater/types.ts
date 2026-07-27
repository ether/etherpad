export type InstallMethod = 'auto' | 'git' | 'docker' | 'npm' | 'managed';

export type Tier = 'off' | 'notify' | 'manual' | 'auto' | 'autonomous';

/**
 * Tier 4 (autonomous) maintenance window. `start`/`end` are HH:MM (24h) in the
 * configured `tz`. `end` is exclusive; `end < start` denotes a cross-midnight
 * window. See `MaintenanceWindow.ts` for the parser/predicate implementation.
 */
export interface MaintenanceWindow {
  start: string;
  end: string;
  tz: 'local' | 'utc';
}

export interface ReleaseInfo {
  /** semver string without leading 'v', e.g. "2.7.2". */
  version: string;
  /** Original GitHub `tag_name`, e.g. "v2.7.2". */
  tag: string;
  /** Markdown body of the release. */
  body: string;
  /** ISO-8601 timestamp from GitHub. */
  publishedAt: string;
  /** True if GitHub flagged it as a prerelease. */
  prerelease: boolean;
  /** GitHub HTML URL for the release page. */
  htmlUrl: string;
}

export interface PolicyResult {
  canNotify: boolean;
  canManual: boolean;
  canAuto: boolean;
  canAutonomous: boolean;
  /** Human-readable string explaining the most-restrictive denial, or "ok". */
  reason: string;
}

export interface EmailSendLog {
  /** Last time we emailed about being severely-outdated, ISO-8601. */
  severeAt: string | null;
  /** Tag of the most recent release for which we sent a Tier 3 `grace-start` email. */
  graceStartTag: string | null;
  /**
   * Dedupe key for `update-rolled-back` / `update-preflight-failed` emails.
   * Stores the `<tag>:<outcome>` of the last failure we emailed about so a
   * retry-loop (e.g. repeated `pnpm install` failures on the same release)
   * doesn't fire one email per attempt. Cleared when the next outcome differs.
   */
  lastFailureKey: string | null;
}

/**
 * Discriminated union mirroring the state machine in
 * docs/superpowers/specs/2026-04-25-auto-update-design.md (section "State machine").
 *
 * `rollback-failed` is the only terminal state that disables auto/autonomous
 * attempts globally until POST /admin/update/acknowledge clears it. Manual
 * remains permitted because an admin clicking Apply *is* the intervention.
 */
export type ExecutionStatus =
  | {status: 'idle'}
  | {status: 'scheduled'; targetTag: string; scheduledFor: string; startedAt: string}
  | {status: 'preflight'; targetTag: string; startedAt: string}
  | {status: 'preflight-failed'; targetTag: string; reason: string; at: string}
  | {status: 'draining'; targetTag: string; drainEndsAt: string; startedAt: string}
  | {status: 'executing'; targetTag: string; fromSha: string; startedAt: string}
  | {status: 'pending-verification'; targetTag: string; fromSha: string; deadlineAt: string}
  | {status: 'verified'; targetTag: string; verifiedAt: string}
  | {status: 'rolling-back'; reason: string; targetTag: string; fromSha: string; at: string}
  | {status: 'rolled-back'; reason: string; targetTag: string; restoredSha: string; at: string}
  | {status: 'rollback-failed'; reason: string; targetTag: string; fromSha: string; at: string};

/** All recognised execution statuses — used by the state validator. */
export const EXECUTION_STATUSES = [
  'idle', 'scheduled', 'preflight', 'preflight-failed', 'draining', 'executing',
  'pending-verification', 'verified', 'rolling-back', 'rolled-back', 'rollback-failed',
] as const;

export type LastUpdateResult = {
  /** Tag we were updating to. */
  targetTag: string;
  /** SHA we were updating from. Empty string when the run never reached executor (e.g. preflight-failed). */
  fromSha: string;
  /** Outcome to surface in admin UI. */
  outcome: 'verified' | 'rolled-back' | 'rollback-failed' | 'preflight-failed' | 'cancelled';
  /** Human-readable reason on non-success. */
  reason: string | null;
  /** ISO timestamp when this result was finalised. */
  at: string;
} | null;

export interface UpdateState {
  /** Schema version of this file. Increment when fields change. */
  schemaVersion: 1;
  /** Last time VersionChecker successfully fetched, ISO-8601. */
  lastCheckAt: string | null;
  /** Last ETag returned by GitHub, used for If-None-Match. */
  lastEtag: string | null;
  /** Cached release info, or null if we've never successfully fetched. */
  latest: ReleaseInfo | null;
  /** Email send dedupe state. */
  email: EmailSendLog;
  /** Current in-flight execution state. Persisted so a restart mid-update reaches RollbackHandler. */
  execution: ExecutionStatus;
  /**
   * Boot counter that the RollbackHandler increments while a `pending-verification`
   * status is live. > 2 means the new version crash-looped; force rollback regardless of timer.
   */
  bootCount: number;
  /** Most recent terminal outcome, surfaced in admin UI even after `execution` returns to idle. */
  lastResult: LastUpdateResult;
}

/** Zero-value initial state. Treat as immutable — spread before mutating: `{...EMPTY_STATE, lastCheckAt: x}`. */
export const EMPTY_STATE: UpdateState = {
  schemaVersion: 1,
  lastCheckAt: null,
  lastEtag: null,
  latest: null,
  email: {
    severeAt: null,
    graceStartTag: null,
    lastFailureKey: null,
  },
  execution: {status: 'idle'},
  bootCount: 0,
  lastResult: null,
};
