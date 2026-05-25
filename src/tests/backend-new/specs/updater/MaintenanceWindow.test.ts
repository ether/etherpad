import {describe, it, expect} from 'vitest';
import {
  parseWindow,
  inWindow,
  nextWindowStart,
} from '../../../../node/updater/MaintenanceWindow';

describe('parseWindow', () => {
  it('accepts a valid same-day window with tz=local', () => {
    expect(parseWindow({start: '03:00', end: '05:00', tz: 'local'})).toEqual({
      start: '03:00', end: '05:00', tz: 'local',
    });
  });
  it('accepts a cross-midnight window', () => {
    expect(parseWindow({start: '22:00', end: '02:00', tz: 'utc'})).toEqual({
      start: '22:00', end: '02:00', tz: 'utc',
    });
  });
  it('rejects malformed start/end strings', () => {
    expect(parseWindow({start: '3:00', end: '05:00', tz: 'local'})).toBeNull();
    expect(parseWindow({start: '03:60', end: '05:00', tz: 'local'})).toBeNull();
    expect(parseWindow({start: '24:00', end: '05:00', tz: 'local'})).toBeNull();
    expect(parseWindow({start: 'oops', end: '05:00', tz: 'local'})).toBeNull();
  });
  it('rejects start === end (zero-length window)', () => {
    expect(parseWindow({start: '03:00', end: '03:00', tz: 'local'})).toBeNull();
  });
  it('rejects unknown tz', () => {
    expect(parseWindow({start: '03:00', end: '05:00', tz: 'pacific'})).toBeNull();
  });
  it('rejects non-object / missing fields', () => {
    expect(parseWindow(null)).toBeNull();
    expect(parseWindow('03:00-05:00')).toBeNull();
    expect(parseWindow({start: '03:00', tz: 'local'})).toBeNull();
    expect(parseWindow({})).toBeNull();
  });
});

describe('inWindow — same-day windows, tz=utc', () => {
  const w = {start: '03:00', end: '05:00', tz: 'utc' as const};
  it('inside the window', () => {
    expect(inWindow(new Date('2026-05-15T03:30:00Z'), w)).toBe(true);
    expect(inWindow(new Date('2026-05-15T03:00:00Z'), w)).toBe(true);
  });
  it('outside before start', () => {
    expect(inWindow(new Date('2026-05-15T02:59:59Z'), w)).toBe(false);
  });
  it('exact end is excluded', () => {
    expect(inWindow(new Date('2026-05-15T05:00:00Z'), w)).toBe(false);
  });
  it('outside after end', () => {
    expect(inWindow(new Date('2026-05-15T06:00:00Z'), w)).toBe(false);
  });
});

describe('inWindow — cross-midnight windows, tz=utc', () => {
  const w = {start: '22:00', end: '02:00', tz: 'utc' as const};
  it('inside before midnight', () => {
    expect(inWindow(new Date('2026-05-15T23:00:00Z'), w)).toBe(true);
  });
  it('inside after midnight', () => {
    expect(inWindow(new Date('2026-05-16T01:00:00Z'), w)).toBe(true);
  });
  it('exact end is excluded', () => {
    expect(inWindow(new Date('2026-05-16T02:00:00Z'), w)).toBe(false);
  });
  it('outside in the daytime gap', () => {
    expect(inWindow(new Date('2026-05-15T12:00:00Z'), w)).toBe(false);
    expect(inWindow(new Date('2026-05-15T21:59:59Z'), w)).toBe(false);
  });
});

describe('inWindow — tz=local respects host wall clock', () => {
  it('matches the host-local hour, not UTC', () => {
    // Construct a Date from local components so the local hour is known
    // regardless of the host TZ.
    const localFour = new Date(2026, 4, 15, 4, 0, 0); // May 15 04:00 local
    const w = {start: '03:00', end: '05:00', tz: 'local' as const};
    expect(inWindow(localFour, w)).toBe(true);
    const localSix = new Date(2026, 4, 15, 6, 0, 0);
    expect(inWindow(localSix, w)).toBe(false);
  });
});

describe('nextWindowStart — same-day, tz=utc', () => {
  const w = {start: '03:00', end: '05:00', tz: 'utc' as const};
  it('before today\'s start returns today at start', () => {
    expect(nextWindowStart(new Date('2026-05-15T01:00:00Z'), w).toISOString())
        .toBe('2026-05-15T03:00:00.000Z');
  });
  it('inside the window returns next day at start', () => {
    expect(nextWindowStart(new Date('2026-05-15T03:30:00Z'), w).toISOString())
        .toBe('2026-05-16T03:00:00.000Z');
  });
  it('after today\'s end returns next day at start', () => {
    expect(nextWindowStart(new Date('2026-05-15T06:00:00Z'), w).toISOString())
        .toBe('2026-05-16T03:00:00.000Z');
  });
});

describe('nextWindowStart — cross-midnight, tz=utc', () => {
  const w = {start: '22:00', end: '02:00', tz: 'utc' as const};
  it('before today\'s start returns today at start', () => {
    expect(nextWindowStart(new Date('2026-05-15T10:00:00Z'), w).toISOString())
        .toBe('2026-05-15T22:00:00.000Z');
  });
  it('between midnight and end returns same-day start (today) since today\'s start has passed → tomorrow', () => {
    // 01:00 is inside the window that started "yesterday at 22:00". The next
    // window-start ≥ now is *today* at 22:00.
    expect(nextWindowStart(new Date('2026-05-16T01:00:00Z'), w).toISOString())
        .toBe('2026-05-16T22:00:00.000Z');
  });
  it('after today\'s start (inside the window) returns tomorrow', () => {
    expect(nextWindowStart(new Date('2026-05-15T23:30:00Z'), w).toISOString())
        .toBe('2026-05-16T22:00:00.000Z');
  });
});

describe('nextWindowStart — tz=local', () => {
  it('returns a Date whose local components match start', () => {
    const w = {start: '03:00', end: '05:00', tz: 'local' as const};
    const now = new Date(2026, 4, 15, 1, 0, 0); // May 15 01:00 local
    const next = nextWindowStart(now, w);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(4); // May
    expect(next.getDate()).toBe(15);
    expect(next.getHours()).toBe(3);
    expect(next.getMinutes()).toBe(0);
  });
});
