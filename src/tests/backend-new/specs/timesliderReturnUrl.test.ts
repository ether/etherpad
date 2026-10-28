'use strict';

import {describe, it, expect} from 'vitest';
import {getReturnToPadUrl} from '../../../static/js/timesliderReturnUrl';

const ts = 'https://pad.example/p/testpad/timeslider?embed=1';

describe('getReturnToPadUrl', () => {
  it('follows a same-origin pad referrer', () => {
    expect(getReturnToPadUrl('https://pad.example/p/testpad?showChat=false', ts))
        .toBe('https://pad.example/p/testpad?showChat=false');
  });

  it('ignores a cross-origin referrer with a /p/ path (GHSA-35rj-7vrx-29wq)', () => {
    for (const ref of ['https://evil.example/p/', 'https://evil.example/p/login',
      'https://evil.example/p/deep/x', 'http://pad.example/p/testpad',
      'https://pad.example.evil.example/p/testpad']) {
      expect(getReturnToPadUrl(ref, ts)).toBe('https://pad.example/p/testpad');
    }
  });

  it('falls back to the pad for an empty or non-pad referrer', () => {
    expect(getReturnToPadUrl('', ts)).toBe('https://pad.example/p/testpad');
    expect(getReturnToPadUrl('not a url', ts)).toBe('https://pad.example/p/testpad');
    expect(getReturnToPadUrl('https://pad.example/admin/', ts))
        .toBe('https://pad.example/p/testpad');
  });

  it('keeps a reverse-proxy prefix', () => {
    expect(getReturnToPadUrl('', 'https://h.example/etherpad/p/a%20b/timeslider?embed=1#x'))
        .toBe('https://h.example/etherpad/p/a%20b');
    expect(getReturnToPadUrl('https://h.example/etherpad/p/a%20b',
        'https://h.example/etherpad/p/a%20b/timeslider?embed=1'))
        .toBe('https://h.example/etherpad/p/a%20b');
  });
});
