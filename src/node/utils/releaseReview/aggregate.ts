'use strict';

import {Finding, Severity, Category, SuppressionEntry} from './types';

const SEVERITY_RANK: Record<Severity, number> = {high: 3, medium: 2, low: 1, info: 0};
const CATEGORY_RANK: Record<Category, number> =
  {cve: 4, bug: 3, perf: 2, 'supply-chain': 1, lint: 0};

const meetsFloor = (sev: Severity, floor: Severity): boolean =>
  SEVERITY_RANK[sev] >= SEVERITY_RANK[floor];

/**
 * Merge findings from N sources, applying suppression and severity floor.
 * Dedupe by fingerprint: highest severity wins, sources are unioned.
 * Sort: severity desc, then category rank desc.
 */
export const aggregate = (
  findingArrays: Finding[][],
  suppression: SuppressionEntry[],
  severityFloor: Severity,
): Finding[] => {
  const suppressed = new Map<string, SuppressionEntry>();
  for (const e of suppression) suppressed.set(e.fingerprint, e);

  const byFingerprint = new Map<string, Finding>();
  for (const arr of findingArrays) {
    for (const f of arr) {
      const sup = suppressed.get(f.fingerprint);
      if (sup && (sup.status === 'wontfix' || sup.status === 'accepted-risk')) continue;
      if (!meetsFloor(f.severity, severityFloor)) continue;
      const annotated: Finding = sup && sup.status === 'deferred'
        ? {...f, firstSeen: sup.decidedInRun}
        : f;
      const existing = byFingerprint.get(annotated.fingerprint);
      if (!existing) {
        byFingerprint.set(annotated.fingerprint, annotated);
      } else {
        const winner = SEVERITY_RANK[annotated.severity] > SEVERITY_RANK[existing.severity]
          ? annotated
          : existing;
        const sources = new Set([existing.source, annotated.source].flatMap((s) => s.split(',')));
        byFingerprint.set(annotated.fingerprint, {
          ...winner,
          source: [...sources].join(','),
        });
      }
    }
  }

  return [...byFingerprint.values()].sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;
    return CATEGORY_RANK[b.category] - CATEGORY_RANK[a.category];
  });
};
