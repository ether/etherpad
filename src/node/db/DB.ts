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

import {Database} from '@samtv12345/ueberdb-rs';
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
  exports.db = new Database(settings.dbType, settings.dbSettings, null);
  // Expose dbSettings for plugin compatibility. ueberdb2 had this property;
  // plugins (e.g. ep_set_title_on_pad) write to it to tune cache behaviour.
  // fast-kv configures its cache via wrapperSettings at construction time, so
  // mutations here are no-ops at the Rust level, but the property must exist
  // to prevent plugins from throwing on load.
  (exports.db as any).dbSettings = settings.dbSettings ?? {};
  await exports.db.init();
  const m = exports.db.metrics();
  if (m != null) {
    for (const [metric, value] of Object.entries(m)) {
      if (typeof value !== 'number') continue;
      stats.gauge(`ueberdb_${metric}`, () => exports.db.metrics()[metric]);
    }
  }
  // napi-rs converts JS values to serde_json::Value directly without calling toJSON() or
  // dropping functions like JSON.stringify does. Sanitize write args to match ueberdb2 behavior.
  const sanitize = (v: any): any => v == null ? v : JSON.parse(JSON.stringify(v));

  for (const fn of ['get', 'set', 'findKeys', 'getSub', 'setSub', 'remove']) {
    const f = exports.db[fn];
    if (fn === 'set') {
      exports[fn] = async (key: string, value: any) => await f.call(exports.db, key, sanitize(value));
    } else if (fn === 'setSub') {
      exports[fn] = async (key: string, path: string[], value: any) => await f.call(exports.db, key, path, sanitize(value));
    } else {
      exports[fn] = async (...args: string[]) => await f.call(exports.db, ...args);
    }
    Object.setPrototypeOf(exports[fn], Object.getPrototypeOf(f));
    Object.defineProperties(exports[fn], Object.getOwnPropertyDescriptors(f));
  }
};

exports.shutdown = async (hookName: string, context:any) => {
  if (exports.db != null) await exports.db.close();
  exports.db = null;
  logger.log('Database closed');
};
