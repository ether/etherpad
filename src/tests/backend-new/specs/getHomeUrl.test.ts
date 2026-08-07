'use strict';

import {describe, it, expect} from 'vitest';
import {getHomeUrl} from '../../../static/js/getHomeUrl';

describe('getHomeUrl', () => {
  it('returns / for a root-deployed pad', () => {
    expect(getHomeUrl('https://example.com/p/testpad')).toBe('https://example.com/');
  });

  it('returns the proxy prefix home for a prefixed pad URL', () => {
    expect(getHomeUrl('https://example.com/etherpad/p/testpad'))
        .toBe('https://example.com/etherpad/');
  });

  it('preserves a deep proxy prefix', () => {
    expect(getHomeUrl('https://example.com/api/hassio_ingress/abc/p/testpad'))
        .toBe('https://example.com/api/hassio_ingress/abc/');
  });
});
