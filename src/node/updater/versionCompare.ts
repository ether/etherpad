import type {VulnerableBelowDirective} from './types';

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[.-].*)?$/;

export const parseSemver = (s: string): ParsedSemver | null => {
  const m = SEMVER_RE.exec(s.trim());
  if (!m) return null;
  return {major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3])};
};

export const compareSemver = (a: string, b: string): -1 | 0 | 1 => {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  return 0;
};

export const isMajorBehind = (current: string, latest: string): boolean => {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return false;
  return l.major - c.major >= 1;
};

const VULN_RE = /<!--\s*updater\s*:\s*vulnerable-below\s+([^\s-][^\s]*)\s*-->/i;

export const parseVulnerableBelow = (body: string): string | null => {
  const m = VULN_RE.exec(body);
  if (!m) return null;
  if (!parseSemver(m[1])) return null;
  return m[1];
};

export const isVulnerable = (
  current: string,
  directives: readonly VulnerableBelowDirective[],
): boolean => {
  for (const d of directives) {
    if (compareSemver(current, d.threshold) < 0) return true;
  }
  return false;
};
