import {describe, it, expect} from 'vitest';
import {
  parseSemver,
  compareSemver,
  isMajorBehind,
  parseVulnerableBelow,
  isVulnerable,
} from '../../../../node/updater/versionCompare';

describe('parseSemver', () => {
  it('parses a plain version', () => {
    expect(parseSemver('2.7.1')).toEqual({major: 2, minor: 7, patch: 1});
  });
  it('strips leading v', () => {
    expect(parseSemver('v2.7.1')).toEqual({major: 2, minor: 7, patch: 1});
  });
  it('returns null for garbage', () => {
    expect(parseSemver('garbage')).toBeNull();
    expect(parseSemver('')).toBeNull();
    expect(parseSemver('2.7')).toBeNull();
  });
  it('strips prerelease suffix', () => {
    expect(parseSemver('2.7.1-rc.1')).toEqual({major: 2, minor: 7, patch: 1});
    expect(parseSemver('v2.7.1-beta')).toEqual({major: 2, minor: 7, patch: 1});
  });
  it('strips build metadata', () => {
    expect(parseSemver('2.7.1+build.123')).toEqual({major: 2, minor: 7, patch: 1});
  });
  it('rejects four-part versions', () => {
    expect(parseSemver('2.7.1.4')).toBeNull();
    expect(parseSemver('2.7.1.foo')).toBeNull();
  });
});

describe('compareSemver', () => {
  it('orders correctly', () => {
    expect(compareSemver('2.7.1', '2.7.2')).toBe(-1);
    expect(compareSemver('2.7.2', '2.7.1')).toBe(1);
    expect(compareSemver('2.7.2', '2.7.2')).toBe(0);
    expect(compareSemver('3.0.0', '2.99.99')).toBe(1);
  });
  it('returns 0 if either is unparsable', () => {
    expect(compareSemver('garbage', '2.7.1')).toBe(0);
  });
});

describe('isMajorBehind', () => {
  it('true when at least one major behind', () => {
    expect(isMajorBehind('2.7.1', '3.0.0')).toBe(true);
    expect(isMajorBehind('2.7.1', '4.0.0')).toBe(true);
  });
  it('false otherwise', () => {
    expect(isMajorBehind('2.7.1', '2.99.99')).toBe(false);
    expect(isMajorBehind('3.0.0', '3.0.0')).toBe(false);
    expect(isMajorBehind('3.0.0', '2.7.1')).toBe(false);
  });
});

describe('parseVulnerableBelow', () => {
  it('extracts directive from release body', () => {
    const body = 'Fixes a few things.\n<!-- updater: vulnerable-below 2.6.4 -->\nMore notes.';
    expect(parseVulnerableBelow(body)).toBe('2.6.4');
  });
  it('tolerates whitespace and casing', () => {
    expect(parseVulnerableBelow('<!--updater:vulnerable-below 1.0.0-->')).toBe('1.0.0');
    expect(parseVulnerableBelow('<!-- UPDATER: VULNERABLE-BELOW 1.0.0 -->')).toBe('1.0.0');
  });
  it('returns null when absent or malformed', () => {
    expect(parseVulnerableBelow('no directive here')).toBeNull();
    expect(parseVulnerableBelow('<!-- updater: vulnerable-below garbage -->')).toBeNull();
  });
});

describe('isVulnerable', () => {
  it('true if current strictly below any directive threshold', () => {
    expect(isVulnerable('2.6.3', [
      {announcedBy: 'v2.7.0', threshold: '2.6.4'},
    ])).toBe(true);
  });
  it('false at or above all thresholds', () => {
    expect(isVulnerable('2.6.4', [
      {announcedBy: 'v2.7.0', threshold: '2.6.4'},
    ])).toBe(false);
    expect(isVulnerable('2.7.0', [])).toBe(false);
  });
  it('handles multiple directives', () => {
    expect(isVulnerable('1.5.0', [
      {announcedBy: 'v2.0.0', threshold: '2.0.0'},
      {announcedBy: 'v3.0.0', threshold: '1.9.0'},
    ])).toBe(true);
  });
});
