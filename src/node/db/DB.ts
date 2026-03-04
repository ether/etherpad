'use strict';

/**
 * The DB Module provides a database initialized with the settings
 * provided by the settings module
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

import {Database, DatabaseType} from 'ueberdb2';
import settings from '../utils/Settings';
import log4js from 'log4js';
const stats = require('../stats')

const logger = log4js.getLogger('ueberDB');

/**
 * The UeberDB Object that provides the database functions
 */
exports.db = null;

/**
 * Initializes the database with the settings provided by the settings module
 */
exports.init = async () => {
  exports.db = new Database(settings.dbType as DatabaseType, settings.dbSettings, null, logger);
  await exports.db.init();
  if (exports.db.metrics != null) {
    for (const [metric, value] of Object.entries(exports.db.metrics)) {
      if (typeof value !== 'number') continue;
      stats.gauge(`ueberdb_${metric}`, () => exports.db.metrics[metric]);
    }
  }
  for (const fn of ['get', 'set', 'findKeys', 'getSub', 'setSub', 'remove']) {
    const f = exports.db[fn];
    exports[fn] = async (...args:string[]) => await f.call(exports.db, ...args);
    Object.setPrototypeOf(exports[fn], Object.getPrototypeOf(f));
    Object.defineProperties(exports[fn], Object.getOwnPropertyDescriptors(f));
  }
};

exports.shutdown = async (hookName: string, context:any) => {
  if (exports.db != null) await exports.db.close();
  exports.db = null;
  logger.log('Database closed');
};
