'use strict';
/**
 * Worker thread to minify JS & CSS files out of the main NodeJS thread
 */

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
 */
const externalFonts: Plugin = {
  name: 'external-fonts',
  setup: (b) => {
    b.onResolve({filter: fontUrlPattern}, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

/*
  * Minify CSS content
  * @param {string} filename - name of the file
  * @param {string} ROOT_DIR - the root dir of Etherpad
 */
export const compressCSS = async (content: string) => {
  const transformedCSS = await build(
    {
      entryPoints: [content],
      minify: true,
      bundle: true,
      plugins: [externalFonts],
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
