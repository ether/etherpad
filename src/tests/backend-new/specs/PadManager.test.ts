/**
 * Unit coverage for PadManager.isValidPadId.
 *
 * PadManager pulls in the database layer (`./DB`) and `Pad` at import time, so
 * those are mocked away — isValidPadId is a pure function and must not require a
 * running database to test.
 */

import {describe, it, expect, vi} from 'vitest';

// Must appear before the PadManager import; vi.mock is hoisted by vitest.
vi.mock('../../../node/db/DB', () => ({
  default: {},
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../../node/db/Pad', () => ({Pad: class {}}));

// PadManager is a CommonJS module; under vitest it must be loaded with `import`
// (the CommonJS `require` resolver cannot resolve the `.ts` source). The mocks
// above are hoisted, so they are already in place when this import evaluates.
const mod: any = await import('../../../node/db/PadManager');
const padManager = mod.default ?? mod;

describe('PadManager.isValidPadId', () => {
  it('accepts ordinary pad ids', () => {
    for (const id of [
      'foo',
      'TF-EVC',
      'TF-LEC_IP03-EMS-CSM',
      'a.b',
      '.foo',
      'foo.',
      "a'b",
      'g.s8oes9dhwrvt0zif$bar', // group pad
    ]) {
      expect(padManager.isValidPadId(id)).toBe(true);
    }
  });

  // Regression test for "Cannot GET /p/": a pad id that is a URL dot-segment
  // ('.' or '..') is normalised away by the browser per the WHATWG URL standard
  // ('/p/.' -> '/p/', '/p/..' -> '/'), so the pad can never be opened or
  // exported. Such ids must be rejected. Before the fix isValidPadId returned
  // true for both, so this test would fail.
  it('rejects URL dot-segment pad ids that would be unreachable', () => {
    expect(padManager.isValidPadId('.')).toBe(false);
    expect(padManager.isValidPadId('..')).toBe(false);
  });

  it('still rejects empty ids and ids containing "$"', () => {
    expect(padManager.isValidPadId('')).toBe(false);
    expect(padManager.isValidPadId('a$b')).toBe(false);
  });
});
