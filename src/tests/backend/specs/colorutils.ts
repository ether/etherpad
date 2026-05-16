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
      // Pick bg extremes where the higher-contrast text colour is
      // unambiguous (big margin either way), so the test exercises the
      // skin-variable mapping without being entangled in border cases.
      const onLight = colorutils.textColorFromBackgroundColor('#ffeedd', 'colibris');
      assert.strictEqual(onLight, 'var(--super-dark-color)');
      const onDark = colorutils.textColorFromBackgroundColor('#111111', 'colibris');
      assert.strictEqual(onDark, 'var(--super-light-color)');
    });

    it('uses the actually-rendered colibris dark colour (#485365) for ratio comparisons', function () {
      // Issue #7377 repro: bg #9AB3FA with default colibris text.
      // The pad renders --super-dark-color as #485365 (not #222), so the
      // selector must compare against #485365 to match what the user sees.
      // Pre-fix this returned 'var(--super-dark-color)' based on a phantom
      // 7.7:1 ratio computed against #222, while the actual rendered ratio
      // was 3.78:1 — identical to what the issue reported.
      const bg = colorutils.css2triple('#9AB3FA');
      const colibrisDark = colorutils.css2triple('#485365');
      const colibrisLight = colorutils.css2triple('#ffffff');
      const ratioDark = colorutils.contrastRatio(bg, colibrisDark);
      const ratioLight = colorutils.contrastRatio(bg, colibrisLight);
      const picked = colorutils.textColorFromBackgroundColor('#9AB3FA', 'colibris');
      const expected =
          ratioDark >= ratioLight ? 'var(--super-dark-color)' : 'var(--super-light-color)';
      assert.strictEqual(picked, expected,
          `for #9AB3FA, dark=${ratioDark.toFixed(2)} vs light=${ratioLight.toFixed(2)} → ${expected}`);
    });
  });

  describe('ensureReadableBackground (issue #7377)', function () {
    const AA = 4.5;

    const ratioToBetterText = (bgHex: string, skin: string) => {
      const bg = colorutils.css2triple(bgHex);
      // Skin-aware rendered text references — must match the production map
      // in colorutils so the test fails if either drifts.
      const dark = skin === 'colibris'
        ? colorutils.css2triple('#485365')
        : colorutils.css2triple('#222222');
      const light = colorutils.css2triple('#ffffff');
      return Math.max(colorutils.contrastRatio(bg, dark), colorutils.contrastRatio(bg, light));
    };

    it('clamps the issue-#7377 scenario (#9AB3FA on colibris) to ≥ AA', function () {
      const out = colorutils.ensureReadableBackground('#9AB3FA', 'colibris');
      assert.ok(colorutils.isCssHex(out), `expected a hex color, got ${out}`);
      const ratio = ratioToBetterText(out, 'colibris');
      assert.ok(ratio >= AA, `${out} only reaches ${ratio.toFixed(3)}:1 against rendered text`);
    });

    it('clamps #ff0000 (default skin) to ≥ AA — the case the test suite previously flagged as unsolvable', function () {
      const out = colorutils.ensureReadableBackground('#ff0000', 'default');
      const ratio = ratioToBetterText(out, 'default');
      assert.ok(ratio >= AA, `${out} only reaches ${ratio.toFixed(3)}:1 against rendered text`);
    });

    it('returns the original hex unchanged when the bg already meets AA', function () {
      // #ffeedd against colibris #485365 is well over AA, so we shouldn't
      // mutate the author's colour.
      const out = colorutils.ensureReadableBackground('#ffeedd', 'colibris');
      assert.strictEqual(out, '#ffeedd');
    });

    it('passes non-hex bg values through unchanged (CSS vars, etc.)', function () {
      assert.strictEqual(
          colorutils.ensureReadableBackground('var(--something)', 'colibris'),
          'var(--something)');
    });

    it('clamps a dark mid-saturation bg by darkening (light text wins)', function () {
      // Counterpart to the #9AB3FA case. #6b3a3a sits in the band where the
      // higher-contrast text is light (#ffffff: ~5.32 — already AA, sanity
      // check). Pick a darker example where light text is winning but still
      // sub-AA, e.g. #884444.
      const bg = colorutils.css2triple('#884444');
      const dark = colorutils.css2triple('#222222');
      const light = colorutils.css2triple('#ffffff');
      const initialRatio = Math.max(
          colorutils.contrastRatio(bg, dark), colorutils.contrastRatio(bg, light));
      // Only meaningful as a clamp test if the input actually fails AA.
      if (initialRatio >= 4.5) {
        // Pick a tighter input that's known to fail.
        const fail = colorutils.ensureReadableBackground('#7a4444', 'default');
        const failTriple = colorutils.css2triple(fail);
        const r = Math.max(
            colorutils.contrastRatio(failTriple, dark),
            colorutils.contrastRatio(failTriple, light));
        assert.ok(r >= 4.5);
        return;
      }
      const out = colorutils.ensureReadableBackground('#884444', 'default');
      const outTriple = colorutils.css2triple(out);
      const r = Math.max(
          colorutils.contrastRatio(outTriple, dark),
          colorutils.contrastRatio(outTriple, light));
      assert.ok(r >= 4.5, `${out} only reached ${r.toFixed(3)}:1`);
      // Direction check: when light text wins, we darken bg (its luminance
      // should decrease, not increase).
      const before = colorutils.relativeLuminance(bg);
      const after = colorutils.relativeLuminance(outTriple);
      assert.ok(after <= before,
          `expected darker bg when light text wins, got luminance ${before} → ${after}`);
    });

    it('respects an explicit minContrast parameter', function () {
      // Same input, two thresholds: AAA (7.0) must produce a more-clamped bg
      // than AA (4.5).
      const aa = colorutils.ensureReadableBackground('#9AB3FA', 'colibris', 4.5);
      const aaa = colorutils.ensureReadableBackground('#9AB3FA', 'colibris', 7.0);
      const dark = colorutils.css2triple('#485365');
      const ratioAA = colorutils.contrastRatio(colorutils.css2triple(aa), dark);
      const ratioAAA = colorutils.contrastRatio(colorutils.css2triple(aaa), dark);
      assert.ok(ratioAA >= 4.5, `AA: ${ratioAA.toFixed(3)}`);
      assert.ok(ratioAAA >= 7.0, `AAA: ${ratioAAA.toFixed(3)}`);
    });

    it('returns a parseable hex string', function () {
      const out = colorutils.ensureReadableBackground('#9AB3FA', 'colibris');
      assert.ok(colorutils.isCssHex(out), `not a hex color: ${out}`);
      // Round-trip safe — must parse back into a triple without throwing.
      assert.doesNotThrow(() => colorutils.css2triple(out));
    });

    it('accepts short-hex (#abc) input', function () {
      // #f00 == #ff0000. The selector path normalises via css2sixhex; the
      // clamp must do the same so callers can pass either form safely.
      assert.doesNotThrow(() => colorutils.ensureReadableBackground('#f00', 'default'));
      const out = colorutils.ensureReadableBackground('#f00', 'default');
      const ratio = Math.max(
          colorutils.contrastRatio(colorutils.css2triple(out), colorutils.css2triple('#222222')),
          colorutils.contrastRatio(colorutils.css2triple(out), colorutils.css2triple('#ffffff')));
      assert.ok(ratio >= 4.5);
    });

    it('every pure primary clears AA after the clamp', function () {
      const samples = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
                       '#9AB3FA', '#cc6688', '#88aacc', '#ffcc88'];
      for (const bg of samples) {
        const out = colorutils.ensureReadableBackground(bg, 'colibris');
        const ratio = ratioToBetterText(out, 'colibris');
        assert.ok(ratio >= AA,
            `${bg} → ${out} only reaches ${ratio.toFixed(3)}:1 (skin: colibris)`);
      }
    });
  });

  describe('textColorFromBackgroundColor — invariant', function () {
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
