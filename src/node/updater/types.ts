export type InstallMethod = 'auto' | 'git' | 'docker' | 'npm' | 'managed';

export type Tier = 'off' | 'notify' | 'manual' | 'auto' | 'autonomous';

/** null = up-to-date (or not yet checked); 'severe' = at least one major version behind; 'vulnerable' = matched a vulnerable-below directive. */
export type OutdatedLevel = null | 'severe' | 'vulnerable';

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

export interface VulnerableBelowDirective {
  /** The release that *announced* the vulnerability (latest release wins on conflict). */
  announcedBy: string;
  /** Versions strictly below this string are considered vulnerable. */
  threshold: string;
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
  /** Last time we emailed about being vulnerable, ISO-8601. */
  vulnerableAt: string | null;
  /** Tag of the release the last "new release while vulnerable" email referenced. */
  vulnerableNewReleaseTag: string | null;
}

export interface UpdateState {
  /** Schema version of this file. Increment when fields change. */
  schemaVersion: 1;
  /** Last time VersionChecker successfully fetched, ISO-8601. */
  lastCheckAt: string | null;
  /** Last ETag returned by GitHub, used for If-None-Match. */
  lastEtag: string | null;
  /** Cached release info, or null if we've never successfully fetched. */
  latest: ReleaseInfo | null;
  /** Vulnerable-below directives parsed from the most recent N releases. */
  vulnerableBelow: VulnerableBelowDirective[];
  /** Email send dedupe state. */
  email: EmailSendLog;
}

/** Zero-value initial state. Treat as immutable — spread before mutating: `{...EMPTY_STATE, lastCheckAt: x}`. */
export const EMPTY_STATE: UpdateState = {
  schemaVersion: 1,
  lastCheckAt: null,
  lastEtag: null,
  latest: null,
  vulnerableBelow: [],
  email: {
    severeAt: null,
    vulnerableAt: null,
    vulnerableNewReleaseTag: null,
  },
};
