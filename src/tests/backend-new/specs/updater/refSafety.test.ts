import {describe, it, expect} from 'vitest';
import {isValidTag, assertValidTag, refsTagsForm} from '../../../../node/updater/refSafety.js';

describe('isValidTag', () => {
  it('accepts plain semver tags', () => {
    expect(isValidTag('v2.7.3')).toBe(true);
    expect(isValidTag('2.7.3')).toBe(true);
    expect(isValidTag('2.7.3-rc.1')).toBe(true);
  });

  it('rejects tags starting with -', () => {
    expect(isValidTag('-rf')).toBe(false);
    expect(isValidTag('-fast-forward')).toBe(false);
    expect(isValidTag('-no-verify')).toBe(false);
  });

  it('rejects tags starting with .', () => {
    expect(isValidTag('.git')).toBe(false);
  });

  it('rejects empty / non-string / overlong', () => {
    expect(isValidTag('')).toBe(false);
    expect(isValidTag(null)).toBe(false);
    expect(isValidTag(undefined)).toBe(false);
    expect(isValidTag(42)).toBe(false);
    expect(isValidTag('v' + 'a'.repeat(300))).toBe(false);
  });

  it('rejects whitespace and control characters', () => {
    expect(isValidTag('v2.7.3 -rf')).toBe(false);
    expect(isValidTag('v2.7.3\nrm -rf')).toBe(false);
    expect(isValidTag('v2.7.3\trf')).toBe(false);
    expect(isValidTag('v2.7.3\x00rf')).toBe(false);
  });

  it('rejects git ref-format violations', () => {
    expect(isValidTag('v2.7..3')).toBe(false); // .. forbidden
    expect(isValidTag('v2~7~3')).toBe(false);  // ~ forbidden
    expect(isValidTag('v2:7:3')).toBe(false);  // : forbidden
    expect(isValidTag('v2.7.3?')).toBe(false); // ? forbidden
    expect(isValidTag('v2.7.3*')).toBe(false); // * forbidden
    expect(isValidTag('v[7]')).toBe(false);    // [ forbidden
    expect(isValidTag('v\\7')).toBe(false);    // \ forbidden
    expect(isValidTag('v^7')).toBe(false);     // ^ forbidden
  });
});

describe('assertValidTag', () => {
  it('returns the tag when valid', () => {
    expect(assertValidTag('v2.7.3')).toBe('v2.7.3');
  });

  it('throws on invalid input', () => {
    expect(() => assertValidTag('-rf')).toThrow(/unsafe release tag/);
    expect(() => assertValidTag(null)).toThrow(/unsafe release tag/);
  });
});

describe('refsTagsForm', () => {
  it('wraps the tag in refs/tags/<tag>', () => {
    expect(refsTagsForm('v2.7.3')).toBe('refs/tags/v2.7.3');
  });
});
