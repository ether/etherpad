'use strict';
/**
 * Library for deterministic relative filename expansion for Etherpad.
 */

/*
 * 2018 - muxator
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
import log4js from 'log4js';
import path from 'path';
import _ from 'underscore';

const absPathLogger = log4js.getLogger('AbsolutePaths');

/*
 * findEtherpadRoot() computes its value only on first invocation.
 * Subsequent invocations are served from this variable.
 */
let etherpadRoot: string|null = null;

/**
 * If stringArray's last elements are exactly equal to lastDesiredElements,
 * returns a copy in which those last elements are popped, or false otherwise.
 *
 * @param {string[]} stringArray - The input array.
 * @param {string[]} lastDesiredElements - The elements to remove from the end
 *                   of the input array.
 * @return {string[]|boolean} The shortened array, or false if there was no
 *                            overlap.
 */
const popIfEndsWith = (stringArray: string[], lastDesiredElements: string[]): string[] | false => {
  if (stringArray.length <= lastDesiredElements.length) {
    absPathLogger.debug(`In order to pop "${lastDesiredElements.join(path.sep)}" ` +
                        `from "${stringArray.join(path.sep)}", it should contain at least ` +
                        `${lastDesiredElements.length + 1} elements`);
    return false;
  }

  const lastElementsFound = _.last(stringArray, lastDesiredElements.length);

  if (_.isEqual(lastElementsFound, lastDesiredElements)) {
    return _.initial(stringArray, lastDesiredElements.length);
  }

  absPathLogger.debug(
      `${stringArray.join(path.sep)} does not end with "${lastDesiredElements.join(path.sep)}"`);
  return false;
};

/**
 * Heuristically computes the directory in which Etherpad is installed.
 *
 * All the relative paths have to be interpreted against this absolute base
 * path. Since the Windows package install has a different layout on disk, it is
 * dealt with as a special case.
 *
 * The path is computed only on first invocation. Subsequent invocations return
 * a cached value.
 *
 * The cached value is stored in AbsolutePaths.etherpadRoot via a side effect.
 *
 * @return {string} The identified absolute base path. If such path cannot be
 *                  identified, prints a log and exits the application.
 */
export const findEtherpadRoot = () => {
  if (etherpadRoot != null) {
    return etherpadRoot;
  }

  const findRoot = require('find-root');
  const foundRoot = findRoot(__dirname);
  const splitFoundRoot = foundRoot.split(path.sep);

  /*
   * On Unix platforms and on Windows manual installs, foundRoot's value will
   * be:
   *
   *   <BASE_DIR>\src
   */
  let maybeEtherpadRoot = popIfEndsWith(splitFoundRoot, ['src']);

  if ((maybeEtherpadRoot === false) && (process.platform === 'win32')) {
    /*
     * If we did not find the path we are expecting, and we are running under
     * Windows, we may still be running from a prebuilt package, whose directory
     * structure is different:
     *
     *   <BASE_DIR>\node_modules\ep_etherpad-lite
     */
    maybeEtherpadRoot = popIfEndsWith(splitFoundRoot, ['node_modules', 'ep_etherpad-lite']);
  }

  if (maybeEtherpadRoot === false) {
    absPathLogger.error('Could not identity Etherpad base path in this ' +
                        `${process.platform} installation in "${foundRoot}"`);
    process.exit(1);
  }

  //  SIDE EFFECT on this module-level variable
  etherpadRoot = maybeEtherpadRoot.join(path.sep);

  if (path.isAbsolute(etherpadRoot)) {
    return etherpadRoot;
  }

  absPathLogger.error(
      `To run, Etherpad has to identify an absolute base path. This is not: "${etherpadRoot}"`);
  process.exit(1);
};

/**
 * Receives a filesystem path in input. If the path is absolute, returns it
 * unchanged. If the path is relative, an absolute version of it is returned,
 * built prepending exports.findEtherpadRoot() to it.
 *
 * @param  {string} somePath - an absolute or relative path
 * @return {string} An absolute path. If the input path was already absolute,
 *                  it is returned unchanged. Otherwise it is interpreted
 *                  relative to exports.root.
 */
export const makeAbsolute = (somePath: string) => {
  if (path.isAbsolute(somePath)) {
    return somePath;
  }

  const rewrittenPath = path.join(findEtherpadRoot(), somePath);

  absPathLogger.debug(`Relative path "${somePath}" can be rewritten to "${rewrittenPath}"`);
  return rewrittenPath;
};

/**
 * Returns whether arbitraryDir is a subdirectory of parent.
 *
 * @param  {string} parent       - a path to check arbitraryDir against
 * @param  {string} arbitraryDir - the function will check if this directory is
 *                                 a subdirectory of the base one
 * @return {boolean}
 */
export const isSubdir = (parent: string, arbitraryDir: string): boolean => {
  // modified from: https://stackoverflow.com/questions/37521893/determine-if-a-path-is-subdirectory-of-another-in-node-js#45242825
  const relative = path.relative(parent, arbitraryDir);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};
