import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

// Simulates a browser that rejects every cookie, as in a pad embedded cross-site over http
// (https://github.com/ether/etherpad/issues/8513).
const jar = new Map<string, string>();
let blocked = true;
vi.mock('../../../static/js/pad_utils', () => ({
  Cookies: {
    get: (name: string) => jar.get(name),
    set: (name: string, value: string) => { if (!blocked) jar.set(name, value); },
  },
}));

describe(__filename, function () {
  let padcookie: any;
  const g = globalThis as any;
  const savedWindow = g.window;

  beforeAll(async function () {
    g.window = {location: {protocol: 'http:'}};
    ({padcookie} = await import('../../../static/js/pad_cookie') as any);
  });

  afterAll(function () {
    g.window = savedWindow;
  });

  beforeEach(function () {
    jar.clear();
    blocked = true;
    padcookie.clear();
  });

  it('getPref returns undefined instead of throwing when cookies are blocked', function () {
    expect(padcookie.getPref('showChat')).toBeUndefined();
  });

  it('setPref keeps the value in memory when cookies are blocked', function () {
    padcookie.setPref('showLineNumbers', false);
    expect(padcookie.getPref('showLineNumbers')).toBe(false);
    expect(jar.size).toBe(0);
  });

  it('still uses the cookie when cookies work', function () {
    blocked = false;
    padcookie.setPref('showChat', true);
    expect(JSON.parse(jar.get('prefsHttp')!)).toEqual({showChat: true});
    jar.set('prefsHttp', JSON.stringify({showChat: false}));
    expect(padcookie.getPref('showChat')).toBe(false);
  });
});
