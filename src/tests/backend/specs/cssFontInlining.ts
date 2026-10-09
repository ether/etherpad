'use strict';

/**
 * Regression coverage for ether/etherpad#8268 — the CSS minifier inlined every
 * font referenced from CSS as a base64 data URL.
 *
 * compressCSS() bundles each stylesheet with esbuild using `dataurl` loaders
 * for the font extensions, so the ~1.7 MB of editor fonts (Montserrat,
 * OpenDyslexic, Roboto, Roboto Mono, Quicksand, Alegreya) and the icon font
 * (as EOT/WOFF/TTF) were embedded in `static/css/pad.css`. Every visitor
 * downloaded all of it — including formats their browser never uses — before
 * the pad could render, and again on each upgrade because the `?v=` cache key
 * changes.
 *
 * The fonts are now left external so the browser fetches only the faces it
 * needs, lazily, and caches them separately from the CSS.
 *
 * These tests pin the behaviour that made the naive fixes fail: esbuild's
 * `external` option only applies to imports, the `file` loader requires an
 * output path, and external globs accept a single wildcard so they cannot
 * match the query-string icon-font URLs (`fontawesome-etherpad.woff?2`). The
 * icon font must therefore stay external too, not just the plain-path fonts.
 */

import {strict as assert} from 'assert';
import fs from 'fs';
import path from 'path';

const {compressCSS} = require('../../../node/utils/MinifyWorker');

const repoRoot = path.join(__dirname, '../../../../');

// Font MIME types esbuild emits for the `dataurl` loader. Kept separate from
// image data URLs, which are legitimately still inlined.
const inlinedFontPattern = /url\(\s*["']?data:(font\/|application\/vnd)/gi;

// Matches `url(...)` references that point at a font file, including the
// `?2` / `?2#iefix` query strings on the Font Awesome icon font.
const externalFontPattern = /url\(\s*["']?([^"')]*\.(?:ttf|otf|woff2?|eot)(?:\?[^"')]*)?)\s*["']?\s*\)/gi;

// Roughly the pre-fix size (1_733_241 bytes reported in the issue, 1_733_220
// measured). The fix brings pad.css to ~61 KB; anything near the old figure
// means fonts are being inlined again.
const maxExpectedBytes = 250_000;

describe(__filename, function () {
  describe('CSS font URLs stay external (issue #8268)', function () {
    let css: string;

    before(async function () {
      this.timeout(120_000);
      css = await compressCSS(path.join(repoRoot, 'src/static/css/pad.css'));
    });

    it('does not inline font data as base64', function () {
      const inlined = css.match(inlinedFontPattern) || [];
      assert.equal(
          inlined.length, 0,
          `expected no inlined font data URLs, found ${inlined.length} ` +
          `(first: ${inlined[0]})`);
    });

    it('keeps the bundled stylesheet small', function () {
      assert.ok(
          css.length < maxExpectedBytes,
          `pad.css minified to ${css.length} bytes, expected < ${maxExpectedBytes}; ` +
          'fonts are likely being inlined again');
    });

    it('preserves the @font-face sources as external URLs', function () {
      // The editor fonts referenced by plain paths.
      for (const font of [
        'Montserrat-Light.otf',
        'Montserrat-Regular.otf',
        'opendyslexic.otf',
        'RobotoMono-Regular.ttf',
        'RobotoMono-Bold.ttf',
        'Quicksand-Regular.ttf',
        'Quicksand-Medium.ttf',
        'Quicksand-Bold.ttf',
        'Roboto-Regular.ttf',
        'Roboto-Bold.ttf',
        'Aleygreya-Medium.woff2',
        'Aleygreya-Medium.woff',
        'Aleygreya-ExtraBold.woff2',
        'Aleygreya-ExtraBold.woff',
      ]) {
        assert.ok(
            css.includes(font),
            `expected external reference to ${font} in the bundled CSS`);
      }
    });

    it('keeps the query-string icon-font URLs external', function () {
      // These are the references a single-wildcard `external` glob cannot
      // match, so they regress independently of the plain-path fonts.
      for (const font of [
        'fontawesome-etherpad.eot?2',
        'fontawesome-etherpad.eot?2#iefix',
        'fontawesome-etherpad.woff?2',
        'fontawesome-etherpad.ttf?2',
      ]) {
        assert.ok(
            css.includes(font),
            `expected external reference to ${font} in the bundled CSS`);
      }
    });

    it('points every external font URL at a file that exists', function () {
      // The URLs are authored in src/static/css/pad/*.css (fonts.css,
      // icons.css) and esbuild emits them verbatim. Browsers resolve them from
      // the served location /static/css/pad.css to /static/font/..., which the
      // server maps back to src/static/font/... — the same file this resolves
      // to from the authoring directory.
      const cssDir = path.join(repoRoot, 'src/static/css/pad');
      const urls = [...css.matchAll(externalFontPattern)].map((m) => m[1]);
      assert.ok(urls.length > 0, 'expected at least one external font URL');
      for (const url of urls) {
        const resolved = path.resolve(cssDir, url.split('?')[0].split('#')[0]);
        assert.ok(
            fs.existsSync(resolved),
            `font URL ${url} does not resolve to an existing file (${resolved})`);
      }
    });
  });
});
