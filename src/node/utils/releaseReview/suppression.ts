'use strict';

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import {SuppressionEntry, SuppressionStatus} from './types';

const VALID_STATUSES: ReadonlySet<SuppressionStatus> =
  new Set(['wontfix', 'accepted-risk', 'deferred']);

const validateEntry = (raw: any, filePath: string, index: number): SuppressionEntry => {
  const where = `${filePath} entry #${index}`;
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${where}: expected object, got ${typeof raw}`);
  }
  // js-yaml parses unquoted ISO dates as Date objects; coerce them back to
  // ISO date strings (YYYY-MM-DD) so downstream code always sees strings.
  for (const dateField of ['decidedAt']) {
    if (raw[dateField] instanceof Date) {
      raw[dateField] = raw[dateField].toISOString().slice(0, 10);
    }
  }
  for (const field of ['fingerprint', 'status', 'decidedAt', 'decidedInRun', 'rationale']) {
    if (typeof raw[field] !== 'string' || raw[field].length === 0) {
      throw new Error(`${where}: missing or empty required field '${field}'`);
    }
  }
  if (!VALID_STATUSES.has(raw.status)) {
    throw new Error(`${where}: invalid status '${raw.status}' (expected wontfix|accepted-risk|deferred)`);
  }
  if (raw.status === 'deferred' && typeof raw.targetRelease !== 'string') {
    throw new Error(`${where}: status 'deferred' requires 'targetRelease'`);
  }
  return raw as SuppressionEntry;
};

/**
 * Load and validate a known-findings.yml file.
 * Returns [] if the file is absent. Throws with file context on malformed YAML
 * or shape errors — never silently drops bad entries.
 */
export const loadSuppression = (filePath: string): SuppressionEntry[] => {
  if (!fs.existsSync(filePath)) return [];
  let parsed: any;
  try {
    parsed = yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (e: any) {
    throw new Error(`Failed to parse YAML at ${filePath}: ${e.message}`);
  }
  if (parsed == null) return [];
  if (typeof parsed !== 'object' || !Array.isArray(parsed.findings)) {
    throw new Error(`${filePath}: expected top-level shape { findings: [...] }`);
  }
  return parsed.findings.map((raw: any, i: number) => validateEntry(raw, filePath, i));
};

/**
 * Append a single entry to an existing known-findings.yml file.
 * Preserves any leading comments / blank lines before the `findings:` key by
 * re-emitting only the findings list with the new entry appended.
 */
export const appendSuppression = (filePath: string, entry: SuppressionEntry): void => {
  const existing = loadSuppression(filePath);
  existing.push(entry);
  // Preserve any header comments by reading the original file up to (but not
  // including) the `findings:` line, then re-emit findings.
  const original = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = original.split('\n');
  const findingsIdx = lines.findIndex((l) => /^findings\s*:/.test(l));
  const header = findingsIdx >= 0 ? lines.slice(0, findingsIdx).join('\n') : '';
  const body = yaml.dump({findings: existing}, {lineWidth: 100, noRefs: true});
  const out = (header.length > 0 ? header.replace(/\n+$/, '') + '\n\n' : '') + body;
  fs.writeFileSync(filePath, out);
};
