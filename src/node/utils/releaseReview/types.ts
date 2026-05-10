'use strict';

export type Severity = 'high' | 'medium' | 'low' | 'info';

export type Category = 'cve' | 'bug' | 'perf' | 'lint' | 'supply-chain';

export type SuppressionStatus = 'wontfix' | 'accepted-risk' | 'deferred';

/** A single finding emitted by Phase 1 (tool sweep) or Phase 2 (AI sweep). */
export interface Finding {
  /** Producing tool or subagent name (e.g., "semgrep", "auth-sessions"). */
  source: string;
  /** Stable hash; see fingerprint.ts. */
  fingerprint: string;
  severity: Severity;
  category: Category;
  /** Repo-relative path. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** Tool rule ID (e.g., "semgrep.javascript.audit.detect-insecure-randomness")
   *  or AI-assigned slug (e.g., "auth-sessions.timing-attack-equality"). */
  ruleId: string;
  message: string;
  /** Optional remediation hint shown to the user during walkthrough. */
  remediationHint?: string;
  /** First run-id this fingerprint was seen in (null if new this run). */
  firstSeen?: string | null;
}

/** A single entry in docs/reviews/known-findings.yml. */
export interface SuppressionEntry {
  fingerprint: string;
  status: SuppressionStatus;
  ruleId?: string;
  file?: string;
  line?: number;
  decidedAt: string;        // ISO date YYYY-MM-DD
  decidedInRun: string;     // run-id
  rationale: string;
  /** Required when status === 'deferred'. */
  targetRelease?: string;
}

/** Result of triage classification. */
export interface TriageBuckets {
  fixNow: Finding[];
  issue: Finding[];
  suppress: Finding[];
}
