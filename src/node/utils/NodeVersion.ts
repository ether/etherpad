'use strict';
/**
 * Checks related to Node runtime version
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

const semver = require('semver');

/**
 * Quits if Etherpad is not running on a given minimum Node version
 *
 * @param  {String}     minNodeVersion   Minimum required Node version
 */
export const enforceMinNodeVersion = (minNodeVersion: string) => {
  const currentNodeVersion = process.version;

  // we cannot use template literals, since we still do not know if we are
  // running under Node >= 4.0
  if (semver.lt(currentNodeVersion, minNodeVersion)) {
    console.error(`Running Etherpad on Node ${currentNodeVersion} is not supported. ` +
                  `Please upgrade at least to Node ${minNodeVersion}`);
    process.exit(1);
  }

  console.debug(`Running on Node ${currentNodeVersion} ` +
                `(minimum required Node version: ${minNodeVersion})`);
};

/**
 * Prints a warning if running on a supported but deprecated Node version
 *
 * @param {String} lowestNonDeprecatedNodeVersion all Node version less than this one are
 *     deprecated
 * @param {Function} epRemovalVersion Etherpad version that will remove support for deprecated
 *     Node releases
 */
export const checkDeprecationStatus = (lowestNonDeprecatedNodeVersion: string, epRemovalVersion: string) => {
  const currentNodeVersion = process.version;

  if (semver.lt(currentNodeVersion, lowestNonDeprecatedNodeVersion)) {
    console.warn(
        `Support for Node ${currentNodeVersion} will be removed in Etherpad ${epRemovalVersion}. ` +
        `Please consider updating at least to Node ${lowestNonDeprecatedNodeVersion}`);
  }
};
