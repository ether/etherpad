import {describe, expect, it} from 'vitest';
import {compareSemver, isMinorOrMoreBehind, parseSemver} from '../../../../node/updater/versionCompare.js';

describe('parseSemver', () => {
  it('parses standard semver', () => {
    expect(parseSemver('1.2.3')).toEqual({major: 1, minor: 2, patch: 3});
  });
  it('accepts v-prefix and pre-release', () => {
    expect(parseSemver('v2.7.3-rc.1')).toEqual({major: 2, minor: 7, patch: 3});
  });
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
  it('rejects garbage', () => {
    expect(parseSemver('not-a-version')).toBeNull();
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('2.7.1.4')).toBeNull();
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
  it('returns -1, 0, 1', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBe(-1);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.2.4', '1.2.3')).toBe(1);
  });
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

describe('isMinorOrMoreBehind', () => {
  it('returns false for equal versions', () => {
    expect(isMinorOrMoreBehind('3.0.0', '3.0.0')).toBe(false);
  });
  it('returns false for current ahead of latest', () => {
    expect(isMinorOrMoreBehind('3.1.0', '3.0.5')).toBe(false);
  });
  it('returns false for patch-only delta', () => {
    expect(isMinorOrMoreBehind('2.7.3', '2.7.4')).toBe(false);
    expect(isMinorOrMoreBehind('3.0.1', '3.0.9')).toBe(false);
  });
  it('returns true for minor delta', () => {
    expect(isMinorOrMoreBehind('3.1.0', '3.2.0')).toBe(true);
    expect(isMinorOrMoreBehind('3.1.5', '3.2.0')).toBe(true);
  });
  it('returns true for major delta', () => {
    expect(isMinorOrMoreBehind('2.7.3', '3.0.0')).toBe(true);
  });
  it('returns false on unparseable input on either side', () => {
    expect(isMinorOrMoreBehind('garbage', '3.0.0')).toBe(false);
    expect(isMinorOrMoreBehind('3.0.0', 'garbage')).toBe(false);
  });
});
