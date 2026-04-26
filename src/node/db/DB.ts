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
import settings from '../utils/Settings.js';
import log4js from 'log4js';
import stats from '../stats.js';

const logger = log4js.getLogger('ueberDB');

/**
 * The UeberDB Object provides the database functions. Mutable so the methods
 * below (get/set/findKeys/...) can be re-bound after init().
 */
const dbModule: any = {
  db: null as Database | null,
  init: async () => {
    dbModule.db = new Database(settings.dbType as DatabaseType, settings.dbSettings, null, logger);
    await dbModule.db.init();
    if (dbModule.db.metrics != null) {
      for (const [metric, value] of Object.entries(dbModule.db.metrics)) {
        if (typeof value !== 'number') continue;
        stats.gauge(`ueberdb_${metric}`, () => {
          const metricValue = dbModule.db?.metrics?.[metric];
          return typeof metricValue === 'number' ? metricValue : 0;
        });
      }
    }
    for (const fn of ['get', 'set', 'findKeys', 'getSub', 'setSub', 'remove']) {
      const f = dbModule.db[fn].bind(dbModule.db);
      dbModule[fn] = async (...args: string[]) => await f(...args);
      Object.setPrototypeOf(dbModule[fn], Object.getPrototypeOf(f));
      Object.defineProperties(dbModule[fn], Object.getOwnPropertyDescriptors(f));
    }
  },
  shutdown: async (_hookName: string, _context: any) => {
    if (dbModule.db != null) await dbModule.db.close();
    dbModule.db = null;
    logger.log('Database closed');
  },
};

export default dbModule;
