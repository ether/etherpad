'use strict';

/**
 * This Module manages all /minified/* requests. It controls the
 * minification && compression of Javascript and CSS.
 */

/*
 * 2011 Peter 'Pita' Martischka (Primary Technology Ltd)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {TransformResult} from "esbuild";
import mime from 'mime-types';
import log4js from 'log4js';
import {compressCSS, compressJS} from './MinifyWorker'

import settings from './Settings';
import {promises as fs} from 'fs';
import path from 'node:path';
const plugins = require('../../static/js/pluginfw/plugin_defs');
import sanitizePathname from './sanitizePathname';
const logger = log4js.getLogger('Minify');

const ROOT_DIR = path.join(settings.root, 'src/static/');


const LIBRARY_WHITELIST = [
  'async',
  'js-cookie',
  'security',
  'split-grid',
  'tinycon',
  'underscore',
  'unorm',
];

// What follows is a terrible hack to avoid loop-back within the server.
// TODO: Serve files from another service, or directly from the file system.
const requestURI = async (url: string | URL, method: any, headers: { [x: string]: any; }) => {
  const parsedUrl = new URL(url);
  let status = 500;
  const content: any[] = [];
  const mockRequest = {
    url,
    method,
    params: {filename: (parsedUrl.pathname + parsedUrl.search).replace(/^\/static\//, '')},
    headers,
  };
  let mockResponse;
  const p = new Promise((resolve) => {
    mockResponse = {
      writeHead: (_status: number, _headers: { [x: string]: any; }) => {
        status = _status;
        for (const header in _headers) {
          if (Object.prototype.hasOwnProperty.call(_headers, header)) {
            headers[header] = _headers[header];
          }
        }
      },
      setHeader: (header: string, value: { toString: () => any; }) => {
        headers[header.toLowerCase()] = value.toString();
      },
      header: (header: string, value: { toString: () => any; }) => {
        headers[header.toLowerCase()] = value.toString();
      },
      write: (_content: any) => {
        _content && content.push(_content);
      },
      end: (_content: any) => {
        _content && content.push(_content);
        resolve([status, headers, content.join('')]);
      },
    };
  });
  await _minify(mockRequest, mockResponse);
  return await p;
};

const _requestURIs = (locations: any[], method: any, headers: {
  [x: string]:
  /**
   * This Module manages all /minified/* requests. It controls the
   * minification && compression of Javascript and CSS.
   */
  /*
   * 2011 Peter 'Pita' Martischka (Primary Technology Ltd)
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *      http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS-IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
    any;
}, callback: (arg0: any[], arg1: any[], arg2: any[]) => void) => {
  Promise.all(locations.map(async (loc) => {
    try {
      return await requestURI(loc, method, headers);
    } catch (err) {
      logger.debug(`requestURI(${JSON.stringify(loc)}, ${JSON.stringify(method)}, ` +
        // @ts-ignore
        `${JSON.stringify(headers)}) failed: ${err.stack || err}`);
      return [500, headers, ''];
    }
  })).then((responses) => {
    // @ts-ignore
    const statuss = responses.map((x) => x[0]);
    // @ts-ignore
    const headerss = responses.map((x) => x[1]);
    // @ts-ignore
    const contentss = responses.map((x) => x[2]);
    callback(statuss, headerss, contentss);
  });
};

const compatPaths = {
  'js/browser.js': 'js/vendors/browser.js',
  'js/farbtastic.js': 'js/vendors/farbtastic.js',
  'js/gritter.js': 'js/vendors/gritter.js',
  'js/html10n.js': 'js/vendors/html10n.js',
  'js/jquery.js': 'js/vendors/jquery.js',
  'js/nice-select.js': 'js/vendors/nice-select.js',
};

/**
 * creates the minifed javascript for the given minified name
 * @param req the Express request
 * @param res the Express response
 */
const _minify = async (req:any, res:any) => {
  let filename = req.params.filename.join('/');
  try {
    filename = sanitizePathname(filename);
  } catch (err) {
    // @ts-ignore
    logger.error(`sanitization of pathname "${filename}" failed: ${err.stack || err}`);
    res.writeHead(404, {});
    res.end();
    return;
  }

  // Backward compatibility for plugins that require() files from old paths.
  // @ts-ignore
  const newLocation = compatPaths[filename.replace(/^plugins\/ep_etherpad-lite\/static\//, '')];
  if (newLocation != null) {
    logger.warn(`request for deprecated path "${filename}", replacing with "${newLocation}"`);
    filename = newLocation;
  }

  /* Handle static files for plugins/libraries:
     paths like "plugins/ep_myplugin/static/js/test.js"
     are rewritten into ROOT_PATH_OF_MYPLUGIN/static/js/test.js,
     commonly ETHERPAD_ROOT/node_modules/ep_myplugin/static/js/test.js
  */
  const match = filename.match(/^plugins\/([^/]+)(\/(?:(static\/.*)|.*))?$/);
  if (match) {
    const library = match[1];
    const libraryPath = match[2] || '';

    if (plugins.plugins[library] && match[3]) {
      const plugin = plugins.plugins[library];
      const pluginPath = plugin.package.realPath;
      filename = path.join(pluginPath, libraryPath);
      // On Windows, path.relative converts forward slashes to backslashes. Convert them back
      // because some of the code below assumes forward slashes. Node.js treats both the backlash
      // and the forward slash characters as pathname component separators on Windows so this does
      // not change the meaning of the pathname. This conversion does not introduce a directory
      // traversal vulnerability because all '..\\' substrings have already been removed by
      // sanitizePathname.
      filename = filename.replace(/\\/g, '/');
    } else if (LIBRARY_WHITELIST.indexOf(library) !== -1) {
      // Go straight into node_modules
      // Avoid `require.resolve()`, since 'mustache' and 'mustache/index.js'
      // would end up resolving to logically distinct resources.
      filename = path.join('../node_modules/', library, libraryPath);
    }
  }
  const [, testf] = /^plugins\/ep_etherpad-lite\/(tests\/frontend\/.*)/.exec(filename) || [];
  if (testf != null) filename = `../${testf}`;

  const contentType = mime.lookup(filename);

  const [date, exists] = await statFile(filename, 3);
  if (date) {
    date.setMilliseconds(0);
    res.setHeader('last-modified', date.toUTCString());
    res.setHeader('date', (new Date()).toUTCString());
    if (settings.maxAge !== undefined) {
      const expiresDate = new Date(Date.now() + settings.maxAge * 1000);
      res.setHeader('expires', expiresDate.toUTCString());
      res.setHeader('cache-control', `max-age=${settings.maxAge}`);
    }
  }

  if (!exists) {
    res.writeHead(404, {});
    res.end();
  } else if (new Date(req.headers['if-modified-since']) >= date) {
    res.writeHead(304, {});
    res.end();
  } else if (req.method === 'HEAD') {
    res.header('Content-Type', contentType);
    res.writeHead(200, {});
    res.end();
  } else if (req.method === 'GET') {
    const content = await getFileCompressed(filename, contentType as string);
    res.header('Content-Type', contentType);
    res.writeHead(200, {});
    res.write(content);
    res.end();
  } else {
    res.writeHead(405, {allow: 'HEAD, GET'});
    res.end();
  }
};

// Check for the existance of the file and get the last modification date.
const statFile = async (filename: string, dirStatLimit: number):Promise<(any | boolean)[]> => {
  /*
   * The only external call to this function provides an explicit value for
   * dirStatLimit: this check could be removed.
   */
  if (typeof dirStatLimit === 'undefined') {
    dirStatLimit = 3;
  }

  if (dirStatLimit < 1 || filename === '' || filename === '/') {
    return [null, false];
  } else {
    let stats;
    try {
      stats = await fs.stat(path.resolve(ROOT_DIR, filename));
    } catch (err) {
      // @ts-ignore
      if (['ENOENT', 'ENOTDIR'].includes(err.code)) {
        // Stat the directory instead.
        const [date] = await statFile(path.dirname(filename), dirStatLimit - 1);
        return [date, false];
      }
      throw err;
    }
    return [stats.mtime, stats.isFile()];
  }
};

let contentCache = new Map();

const getFileCompressed = async (filename: any, contentType: string) => {
  if (contentCache.has(filename)) {
    return contentCache.get(filename);
  }
  let content: Buffer|string = await getFile(filename);
  if (!content || !settings.minify) {
    return content;
  } else if (contentType === 'application/javascript') {
    return await new Promise(async (resolve) => {
      try {
        logger.info('Compress JS file %s.', filename);

        content = content.toString();
        try {
          let compressResult:  TransformResult<{ minify: boolean }>
          compressResult = await compressJS(content);
          content = compressResult.code.toString(); // Convert content obj code to string
        } catch (error) {
          console.error(`Error compressing JS (${filename}) using esbuild`, error);
        }
      } catch (error) {
        console.error('getFile() returned an error in ' +
          `getFileCompressed(${filename}, ${contentType}): ${error}`);
      }
      contentCache.set(filename, content);
      resolve(content);
    });
  } else if (contentType === 'text/css') {
    return await new Promise(async (resolve) => {
      try {
        logger.info('Compress CSS file %s.', filename);

        try {
          content = await compressCSS(path.resolve(ROOT_DIR, filename));
        } catch (error) {
          console.error(`CleanCSS.minify() returned an error on ${filename}: ${error}`);
        }
        contentCache.set(filename, content);
        resolve(content);
      } catch (e) {
        console.error('getFile() returned an error in ' +
          `getFileCompressed(${filename}, ${contentType}): ${e}`);
      }
    })
  } else {
    contentCache.set(filename, content);
    return content;
  }
};

const getFile = async (filename: any) => {
  return await fs.readFile(path.resolve(ROOT_DIR, filename));
};

export const minify = (req:any, res:any, next:Function) => _minify(req, res).catch((err) => next(err || new Error(err)));

export const requestURIs = _requestURIs;

export const shutdown = async (hookName: string, context:any) => {
  contentCache = new Map();
};
