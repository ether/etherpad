export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

// Accepts optional prerelease (e.g. -rc.1) and build-metadata (e.g. +build.123).
// Four-part versions like 2.7.1.4 are rejected — use standard semver only.
const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

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

// True iff `current` is at least one minor version behind `latest`.
// Equivalent to: latest.major > current.major, OR same major and
// latest.minor > current.minor. Patch-only deltas return false, equal
// versions return false, current newer than latest returns false.
export const isMinorOrMoreBehind = (current: string, latest: string): boolean => {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return false;
  if (l.major !== c.major) return l.major > c.major;
  return l.minor > c.minor;
};
