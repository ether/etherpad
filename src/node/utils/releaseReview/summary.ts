'use strict';

import * as fs from 'fs';

export type DecisionAction = 'fix' | 'issue' | 'wontfix' | 'accepted-risk' | 'deferred' | 'skip';

export interface Decision {
  fingerprint: string;
  action: DecisionAction;
  file: string;
  ruleId: string;
  rationale?: string;
  issueUrl?: string;
}

export interface SummaryInput {
  runId: string;
  version: string;
  counts: {high?: number; medium?: number; low?: number; info?: number};
  decisions: Decision[];
}

const ACTION_HEADINGS: Record<DecisionAction, string> = {
  fix: 'Fixed in this session',
  issue: 'Filed as GitHub issue',
  wontfix: 'Marked WONTFIX',
  'accepted-risk': 'Marked accepted-risk',
  deferred: 'Deferred',
  skip: 'Skipped (no decision)',
};

const groupBy = <T>(arr: T[], key: (t: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const t of arr) {
    const k = key(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  return m;
};

export const writeSummary = (input: SummaryInput, outputPath: string): void => {
  const lines: string[] = [];
  lines.push(`# /release-review summary — ${input.version}`);
  lines.push('');
  lines.push(`**Run:** \`${input.runId}\``);
  lines.push('');
  lines.push('## Finding counts');
  lines.push('');
  for (const sev of ['high', 'medium', 'low', 'info'] as const) {
    if (input.counts[sev] != null) lines.push(`- **${sev}**: ${input.counts[sev]}`);
  }
  lines.push('');
  lines.push('## Decisions');
  lines.push('');
  if (input.decisions.length === 0) {
    lines.push('_No decisions taken in this session._');
  } else {
    const groups = groupBy(input.decisions, (d) => d.action);
    for (const action of Object.keys(ACTION_HEADINGS) as DecisionAction[]) {
      const group = groups.get(action);
      if (!group || group.length === 0) continue;
      lines.push(`### ${ACTION_HEADINGS[action]}`);
      lines.push('');
      for (const d of group) {
        const issue = d.issueUrl ? ` ([#issue](${d.issueUrl}))` : '';
        const rat = d.rationale ? ` — _${d.rationale}_` : '';
        lines.push(`- \`${d.file}\` — ${d.ruleId}${issue}${rat}`);
      }
      lines.push('');
    }
  }
  fs.writeFileSync(outputPath, lines.join('\n'));
};
