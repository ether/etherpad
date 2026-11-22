import {describe, expect, it} from 'vitest';
import {interactionPath, isValidInteractionUid} from '../../../../ui/src/interaction';

// The OIDC login/consent pages build their POST target from the `state`
// query parameter.
describe('OIDC interaction path', () => {
  it('accepts an oidc-provider (nanoid) uid', () => {
    expect(interactionPath('V1StGXR8_Z5jdHi6B-myT')).toBe('/interaction/V1StGXR8_Z5jdHi6B-myT');
  });

  for (const bad of [
    null, undefined, '', '../../p/other', '..%2f..%2fp', '%2e%2e',
    'a/b', 'a\\b', 'a?b', 'a#b', 'a b', '.', '..', 'x'.repeat(129), 123,
  ]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(isValidInteractionUid(bad)).toBe(false);
      expect(interactionPath(bad)).toBeNull();
    });
  }

  it('the resolved URL always stays under /interaction/', () => {
    const p = interactionPath('abc_DEF-123')!;
    expect(new URL(p, 'https://pad.example/').pathname).toBe('/interaction/abc_DEF-123');
  });
});
