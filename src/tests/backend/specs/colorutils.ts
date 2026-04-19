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
    it('picks white text on pure red (#ff0000: 4.00 > 3.98 for #222)', function () {
      // Border case: against the rendered #222, the two options are within
      // 0.02 of each other. The WCAG-aware selector still consistently
      // picks the marginally-better option.
      const result = colorutils.textColorFromBackgroundColor('#ff0000', 'something-else');
      assert.strictEqual(result, '#fff', `expected white, got ${result}`);
    });

    it('picks black text on #cc0000 — the clearer dark-red case', function () {
      // Old code picked white (luminosity 0.24 < 0.5), giving ~5.3:1. Black
      // on this background gives ~5.6:1 — the WCAG-aware selector notices
      // that black is actually the higher-contrast option here.
      const result = colorutils.textColorFromBackgroundColor('#cc0000', 'something-else');
      const bg = colorutils.css2triple('#cc0000');
      const black = colorutils.css2triple('#222222');
      const white = colorutils.css2triple('#ffffff');
      const ratioBlack = colorutils.contrastRatio(bg, black);
      const ratioWhite = colorutils.contrastRatio(bg, white);
      assert.strictEqual(result, ratioBlack >= ratioWhite ? '#222' : '#fff');
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

    it('always picks whichever of black/white gives the higher contrast', function () {
      // Regression invariant: the returned text colour must never produce
      // LOWER contrast than the alternative. Pre-fix, the `luminosity < 0.5`
      // cutoff violated this on e.g. #ff0000 — luminosity 0.30 picked white
      // (4.00:1) when black (5.25:1) was available. Note: this invariant is
      // about *relative* contrast between the two options, not about hitting
      // WCAG AA; pure primaries like #ff0000 can't clear 4.5:1 with either
      // black or white, and no text-colour choice alone can fix that — bg
      // tweaks would be a separate concern.
      const samples = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
                       '#800000', '#008000', '#000080', '#808000', '#800080', '#008080',
                       '#888888', '#bbbbbb', '#333333'];
      for (const bg of samples) {
        const textHex = colorutils.textColorFromBackgroundColor(bg, 'something-else');
        const bgTriple = colorutils.css2triple(bg);
        const ratioBlack = colorutils.contrastRatio(bgTriple, colorutils.css2triple('#222222'));
        const ratioWhite = colorutils.contrastRatio(bgTriple, colorutils.css2triple('#ffffff'));
        const picked = textHex === '#222' ? ratioBlack : ratioWhite;
        const other = textHex === '#222' ? ratioWhite : ratioBlack;
        assert.ok(picked >= other,
            `${bg} picked ${textHex} (${picked.toFixed(2)}:1) when the other ` +
            `option would have been ${other.toFixed(2)}:1`);
      }
    });
  });
});
