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
  });

  describe('textColorFromBackgroundColor (WCAG-aware, issue #7377)', function () {
    // Exact failure case from the issue screenshot. Pre-fix the
    // luminosity < 0.5 cutoff picked white text on #ff0000, giving a 4.0
    // contrast ratio — below WCAG AA.
    it('picks black text on #ff0000 (contrast 5.25 > 4.0 for white)', function () {
      const result = colorutils.textColorFromBackgroundColor('#ff0000', 'something-else');
      assert.strictEqual(result, '#222', `expected black-ish, got ${result}`);
    });

    it('picks white text on dark backgrounds', function () {
      const result = colorutils.textColorFromBackgroundColor('#111111', 'something-else');
      assert.strictEqual(result, '#fff');
    });

    it('picks black text on light backgrounds', function () {
      const result = colorutils.textColorFromBackgroundColor('#f8f8f8', 'something-else');
      assert.strictEqual(result, '#222');
    });

    it('returns colibris CSS vars when the skin matches', function () {
      const onRed = colorutils.textColorFromBackgroundColor('#ff0000', 'colibris');
      assert.strictEqual(onRed, 'var(--super-dark-color)');
      const onNavy = colorutils.textColorFromBackgroundColor('#111111', 'colibris');
      assert.strictEqual(onNavy, 'var(--super-light-color)');
    });

    it('every primary picks a text colour clearing WCAG AA', function () {
      // The dead-zone regression: for every pure-ish primary, the returned
      // text colour must produce ≥4.5:1 contrast.
      const samples = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
                       '#800000', '#008000', '#000080', '#808000', '#800080', '#008080'];
      for (const bg of samples) {
        const textHex = colorutils.textColorFromBackgroundColor(bg, 'something-else');
        const textTriple = textHex === '#222'
            ? colorutils.css2triple('#222222')
            : colorutils.css2triple('#ffffff');
        const ratio = colorutils.contrastRatio(colorutils.css2triple(bg), textTriple);
        assert.ok(ratio >= 4.5, `${bg} → ${textHex} gave only ${ratio.toFixed(2)}:1`);
      }
    });
  });
});
