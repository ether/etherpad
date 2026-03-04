'use strict';
/**
 * Worker thread to minify JS & CSS files out of the main NodeJS thread
 */

import {build, transform} from 'esbuild';

/*
  * Minify JS content
  * @param {string} content - JS content to minify
 */
export const compressJS = async (content: string) => {
  return await transform(content, {minify: true});
}

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
      loader:{
        '.jpg': 'dataurl',
        '.png': 'dataurl',
        '.gif': 'dataurl',
        '.ttf': 'dataurl',
        '.otf': 'dataurl',
        '.woff': 'dataurl',
        '.woff2': 'dataurl',
        '.eot': 'dataurl',
        '.svg': 'dataurl'
      },
      write: false
    }
  )
  return transformedCSS.outputFiles[0].text
};
