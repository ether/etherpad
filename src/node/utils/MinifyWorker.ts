'use strict';
/**
 * Worker thread to minify JS & CSS files out of the main NodeJS thread
 */

import {realpath} from 'node:fs/promises';
import path from 'node:path';
import {build, transform} from 'esbuild';
import type {Plugin} from 'esbuild';

/*
  * Minify JS content
  * @param {string} content - JS content to minify
 */
export const compressJS = async (content: string) => {
  return await transform(content, {minify: true});
}

const fontUrlPattern = /\.(ttf|otf|woff2?|eot)(\?.*)?$/i;

/*
  * Leaves font `url()` references in CSS external instead of inlining them as
  * base64. esbuild has no built-in way to do this: the `external` option only
  * applies to imports, the `file` loader needs an output path, and external
  * globs accept a single wildcard so they cannot match query-string URLs such
  * as `fontawesome-etherpad.woff?2`.
  *
  * Inlining the fonts made `static/css/pad.css` ~1.7 MB, which every visitor
  * had to download (and re-download on each upgrade) before the pad could
  * render. Keeping the URLs external lets the browser fetch only the fonts it
  * actually uses, lazily, and cache them separately from the CSS.
  *
  * External URLs are emitted verbatim, so relative paths are rebased onto the
  * directory of the bundled stylesheet: the authored paths are relative to the
  * importing file, which only resolves correctly when the bundle happens to be
  * served from the document root. Rebased URLs stay correct under a subpath
  * prefix because served files mirror their layout under `src/static`. Query
  * strings and fragments (`?2`, `#iefix`) are part of the last path segment,
  * so rebasing keeps them.
  */
const externalFonts = (entryDir: string): Plugin => ({
  name: 'external-fonts',
  setup: (b) => {
    const root = new URL('http://url.invalid/');
    b.onResolve({filter: fontUrlPattern}, (args) => {
      const url = URL.parse(args.path, root);
      // Absolute URLs (`http://…`, `//host/…`, `/root-relative`) are emitted as-is.
      if (url == null || url.origin !== root.origin || path.isAbsolute(args.path)) {
        return {path: args.path, external: true};
      }
      const rebased = path
        .relative(entryDir, path.resolve(args.resolveDir, args.path))
        .split(path.sep).join('/');
      return {path: rebased, external: true};
    });
  },
});

/*
  * Minify CSS content
  * @param {string} filename - name of the file
 */
export const compressCSS = async (filename: string) => {
  // esbuild resolves symlinks, so `args.resolveDir` in the font plugin is a
  // real path. Plugins live behind a symlink (`plugin_packages/ep_x` ->
  // `plugin_packages/.versions/ep_x@1.2.3`), so the entry directory must be
  // resolved the same way or the rebased URL escapes the plugin directory
  // (`../../../.versions/ep_x@1.2.3/...`) and 404s.
  const entry = await realpath(path.resolve(filename));
  const transformedCSS = await build(
    {
      entryPoints: [entry],
      minify: true,
      bundle: true,
      plugins: [externalFonts(path.dirname(entry))],
      loader:{
        '.jpg': 'dataurl',
        '.png': 'dataurl',
        '.gif': 'dataurl',
        '.svg': 'dataurl'
      },
      write: false
    }
  )
  return transformedCSS.outputFiles[0].text
};
