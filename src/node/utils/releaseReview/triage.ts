'use strict';

import {Finding, TriageBuckets} from './types';

const KNOWN_TOOL_SOURCES = new Set([
  'pnpm-audit', 'osv-scanner', 'semgrep', 'eslint', 'madge', 'depcheck',
]);

const isToolSource = (src: string): boolean =>
  src.split(',').some((s) => KNOWN_TOOL_SOURCES.has(s.trim()));

/**
 * Heuristic auto-triage. Best-effort; user always confirms.
 */
export const classify = (findings: readonly Finding[]): TriageBuckets => {
  const buckets: TriageBuckets = {fixNow: [], issue: [], suppress: []};
  for (const f of findings) {
    if (f.category === 'lint') {
      buckets.suppress.push(f);
      continue;
    }
    if (f.remediationHint && f.remediationHint.length > 0) {
      buckets.fixNow.push(f);
      continue;
    }
    // Medium tool-only finding without a hint: likely false-positive territory.
    if (f.severity === 'medium' && isToolSource(f.source)) {
      buckets.suppress.push(f);
      continue;
    }
    // Everything else needs human design work.
    buckets.issue.push(f);
  }
  return buckets;
};
