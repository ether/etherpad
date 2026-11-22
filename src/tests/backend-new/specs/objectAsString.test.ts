import {describe, it, expect} from 'vitest';
import {objectAsString, MAX_DEPTH, MAX_LENGTH} from '../../../node/utils/objectAsString';

const deepObject = (n: number) => {
  let o: any = 1;
  for (let i = 0; i < n; i++) o = {a: o};
  return o;
};

describe('objectAsString', () => {
  it('renders the diagnostic info the pad client sends', () => {
    expect(objectAsString({
      disconnectedMessage: 'socket.io timeout',
      padId: 'foo',
      socket: {connected: false},
      list: [1, 2],
      fn: () => {},
    })).toBe('disconnectedMessage: socket.io timeout; padId: foo; ' +
             'socket: {connected: false; }; list: 1,2; ');
  });

  it('does not overflow the stack on deeply nested objects', () => {
    const out = objectAsString(deepObject(50000));
    expect(out).toContain('{...}');
    expect(out.split('{').length - 1).toBe(MAX_DEPTH + 1);
  });

  it('does not overflow the stack on deeply nested arrays', () => {
    let a: any = 1;
    for (let i = 0; i < 50000; i++) a = [a];
    expect(objectAsString({a})).toContain('[...]');
  });

  it('caps the output length for wide input', () => {
    const wide: any = {};
    for (let i = 0; i < 20000; i++) wide[`k${i}`] = {x: 'y'.repeat(10)};
    const out = objectAsString(wide);
    expect(out.length).toBeLessThanOrEqual(MAX_LENGTH + 3);
    expect(out.endsWith('...')).toBe(true);
  });
});
