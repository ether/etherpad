'use strict';

import SkipList from 'ep_etherpad-lite/static/js/skiplist';
import {expect, describe, it} from 'vitest';

describe('skiplist.js', function () {
  it('rejects null keys', async function () {
    const skiplist = new SkipList();
    for (const key of [undefined, null]) {
      // @ts-ignore
      expect(() => skiplist.push({key})).toThrowError();
    }
  });

  it('rejects duplicate keys', async function () {
    const skiplist = new SkipList();
    skiplist.push({key: 'foo'});
    expect(() => skiplist.push({key: 'foo'})).toThrowError();
  });

  it('atOffset() returns last entry that touches offset', async function () {
    const skiplist = new SkipList();
    const entries: { key: string; width: number; }[] = [];
    let nextId = 0;
    const makeEntry = (width: number) => {
      const entry = {key: `id${nextId++}`, width};
      entries.push(entry);
      return entry;
    };

    skiplist.push(makeEntry(5));
    expect(skiplist.atOffset(4)).toBe(entries[0]);
    expect(skiplist.atOffset(5)).toBe(entries[0]);
    expect(() => skiplist.atOffset(6)).toThrowError();

    skiplist.push(makeEntry(0));
    expect(skiplist.atOffset(4)).toBe(entries[0]);
    expect(skiplist.atOffset(5)).toBe(entries[1]);
    expect(() => skiplist.atOffset(6)).toThrowError();

    skiplist.push(makeEntry(0));
    expect(skiplist.atOffset(4)).toBe(entries[0]);
    expect(skiplist.atOffset(5)).toBe(entries[2]);
    expect(() => skiplist.atOffset(6)).toThrowError();

    skiplist.splice(2, 0, [makeEntry(0)]);
    expect(skiplist.atOffset(4)).toBe(entries[0]);
    expect(skiplist.atOffset(5)).toBe(entries[2]);
    expect(() => skiplist.atOffset(6)).toThrowError();

    skiplist.push(makeEntry(3));
    expect(skiplist.atOffset(4)).toBe(entries[0]);
    expect(skiplist.atOffset(5)).toBe(entries[4]);
    expect(skiplist.atOffset(6)).toBe(entries[4]);
  });
});
