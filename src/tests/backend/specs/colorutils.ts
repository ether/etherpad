'use strict';

const assert = require('assert').strict;
const {colorutils} = require('../../../static/js/colorutils');

// Unit coverage for the WCAG helpers added in #7377.
// Kept backend-side so it runs in plain mocha without a browser; colorutils
// is pure and has no DOM deps.
describe(__filename, function () {
  describe('relativeLuminance', function () {
    it('returns 0 for pure black and 1 for pure white', function () {
      assert.strictEqual(colorutils.relativeLuminance([0, 0, 0]), 0);
      assert.strictEqual(colorutils.relativeLuminance([1, 1, 1]), 1);
    });

    it('matches the WCAG 2.1 reference values (within 1e-3)', function () {
      // Spot-check against published examples from the WCAG spec:
      //   #808080 (mid grey) → ~0.2159
      //   #ff0000 (pure red) → ~0.2126 (red coefficient)
      const grey = colorutils.relativeLuminance([0x80 / 255, 0x80 / 255, 0x80 / 255]);
      const red = colorutils.relativeLuminance([1, 0, 0]);
      assert.ok(Math.abs(grey - 0.2159) < 1e-3, `grey luminance: ${grey}`);
      assert.ok(Math.abs(red - 0.2126) < 1e-3, `red luminance: ${red}`);
    });
  });

  describe('contrastRatio', function () {
    it('is 21 between black and white', function () {
      assert.strictEqual(colorutils.contrastRatio([0, 0, 0], [1, 1, 1]), 21);
    });

    it('is 1 between identical colors', function () {
      assert.strictEqual(colorutils.contrastRatio([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), 1);
    });

    it('fails WCAG AA for mid-tone red on black (<4.5)', function () {
      // #cc0000-ish — a common "author color" range.
      const ratio = colorutils.contrastRatio([0.8, 0, 0], [0, 0, 0]);
      assert.ok(ratio < 4.5, `expected <4.5, got ${ratio}`);
    });
  });

  describe('ensureReadableBackground', function () {
    it('leaves light enough backgrounds unchanged', function () {
      // Pastel blue: already has adequate contrast with black text.
      const light = '#aaccff';
      assert.strictEqual(
          colorutils.ensureReadableBackground(light), light,
          'a bg that already satisfies 4.5:1 must be returned verbatim');
    });

    it('leaves very dark backgrounds unchanged (white text handles it)', function () {
      // Near-black bg pairs with white text for contrast >> 4.5 — leave it.
      const dark = '#111111';
      assert.strictEqual(
          colorutils.ensureReadableBackground(dark), dark,
          'a bg that works with white text must be returned verbatim');
    });

    it('lightens mid-tone backgrounds until they pass WCAG AA with black text', function () {
      // #cc0000 is the exact failure case from the issue screenshot — dark
      // enough that black text is hard to read, but not dark enough for
      // white text to hit 4.5:1 either.
      const result = colorutils.ensureReadableBackground('#cc0000');
      assert.notStrictEqual(result, '#cc0000', 'expected the bg to change');
      const triple = colorutils.css2triple(result);
      const ratio = colorutils.contrastRatio(triple, [0, 0, 0]);
      assert.ok(ratio >= 4.5, `post-clamp contrast must be >=4.5, got ${ratio}`);
    });

    it('respects a custom minContrast target', function () {
      const result = colorutils.ensureReadableBackground('#888888', 7.0);
      const triple = colorutils.css2triple(result);
      const ratio = colorutils.contrastRatio(triple, [0, 0, 0]);
      assert.ok(ratio >= 7.0, `AAA contrast target not met: ${ratio}`);
    });
  });
});
