import {describe, expect, it} from 'vitest';
import {firstAuthorOf} from '../../../../../node/hooks/express/updateStatus';

const makePad = (entries: Record<number, [string, string]>): any => ({
  pool: {numToAttrib: entries},
});

describe('firstAuthorOf', () => {
  it('returns null for a pad with no attribs', () => {
    expect(firstAuthorOf(makePad({}))).toBeNull();
  });

  it('returns null when no author attribs exist', () => {
    expect(firstAuthorOf(makePad({0: ['bold', 'true'], 1: ['italic', 'true']}))).toBeNull();
  });

  it('returns the only author when there is one', () => {
    expect(firstAuthorOf(makePad({0: ['author', 'a.alice']}))).toBe('a.alice');
  });

  it('returns the lowest-numbered author when there are several', () => {
    expect(firstAuthorOf(makePad({
      0: ['bold', 'true'],
      1: ['author', 'a.alice'],
      2: ['author', 'a.bob'],
    }))).toBe('a.alice');
  });

  it('skips empty-string author placeholders', () => {
    expect(firstAuthorOf(makePad({
      0: ['author', ''],
      1: ['author', 'a.alice'],
    }))).toBe('a.alice');
  });

  it('walks keys in numeric order, not string order', () => {
    expect(firstAuthorOf(makePad({
      10: ['author', 'a.bob'],
      2: ['author', 'a.alice'],
    }))).toBe('a.alice');
  });
});
