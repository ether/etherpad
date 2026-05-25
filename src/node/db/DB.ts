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

// Type-only — erased at compile/build. Keeping ueberdb2 out of the top-level
// import list lets the generated CJS twin (dist-cjs/node/db/DB.cjs) load
// without trying to `require('ueberdb2')` synchronously: ueberdb2 v6 is
// ESM-only and has no `require` export condition, so a top-level
// `require('ueberdb2')` from a plugin's CJS code crashes the load. The
// actual ueberdb2 Database class is imported lazily inside init() via a
// dynamic `import()`, which is supported in both ESM and CJS contexts.
import type {Database, DatabaseType} from 'ueberdb2';
import settings from '../utils/Settings.js';
import log4js from 'log4js';
import stats from '../stats.js';

const logger = log4js.getLogger('ueberDB');

// Cross-module-instance singleton. Etherpad's ESM startup imports this
// module via `import dbModule from './DB.js'`. Plugins authored as CJS
// reach the same module through `require('ep_etherpad-lite/node/db/DB')`,
// which resolves to the CJS twin (dist-cjs/node/db/DB.cjs) — a separate
// module record in Node's cache. Without a shared backing store the two
// records would each carry their own `db` handle and method wrappers,
// and the plugin's would never be initialized (etherpad calls init()
// on the ESM record only). Stash the live state on globalThis so both
// records see the same db connection and the same wrappers once any
// one of them has been initialized.
type SharedDb = {
  db: Database | null;
  wrappers: Record<string, (...args: any[]) => any>;
};
const GLOBAL_KEY = '__etherpad_dbModule_shared__';
const g = globalThis as unknown as {[GLOBAL_KEY]?: SharedDb};
if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = {db: null, wrappers: {}};
const shared = g[GLOBAL_KEY]!;

const init = async () => {
  if (shared.db != null) return; // already initialized by another module record
  const ueberdb2 = await import('ueberdb2');
  shared.db = new ueberdb2.Database(
      settings.dbType as DatabaseType, settings.dbSettings, null, logger);
  await shared.db.init();
  if (shared.db.metrics != null) {
    for (const [metric, value] of Object.entries(shared.db.metrics)) {
      if (typeof value !== 'number') continue;
      stats.gauge(`ueberdb_${metric}`, () => {
        const metricValue = shared.db?.metrics?.[metric];
        return typeof metricValue === 'number' ? metricValue : 0;
      });
    }
  }
  for (const fn of ['get', 'set', 'findKeys', 'findKeysPaged', 'getSub', 'setSub', 'remove']) {
    const f = (shared.db as any)[fn];
    if (typeof f !== 'function') {
      throw new Error(
          `ueberdb2 ${shared.db!.constructor.name} is missing required method ${fn}; ` +
            'check that ueberdb2 is at the minimum version pinned in package.json');
    }
    shared.wrappers[fn] = async (...args: any[]) => {
      // During shutdown, background timers (for example session cleanup) can still
      // attempt DB access for a short period. Avoid crashing the process in that
      // window if the DB has already been closed.
      if (shared.db == null) {
        if (fn === 'get' || fn === 'getSub') return null;
        if (fn === 'findKeys' || fn === 'findKeysPaged') return [];
        return;
      }
      return await (shared.db as any)[fn].call(shared.db, ...args);
    };
  }
};

const shutdown = async (_hookName: string, _context: any) => {
  if (shared.db != null) await shared.db.close();
  shared.db = null;
  logger.log('Database closed');
};

/**
 * The UeberDB Object provides the database functions. Reads/writes go
 * through a Proxy that resolves the live `db` handle and the wrapper
 * methods from the cross-module-instance shared state above.
 */
// Wrapper method names installed by init(). Listed here as well so tests
// that mutate `db.set = ...` BEFORE init runs land in shared.wrappers
// rather than on the local proxy target (which would be invisible to
// the post-init readers).
const WRAPPER_NAMES = new Set([
  'get', 'set', 'findKeys', 'findKeysPaged', 'getSub', 'setSub', 'remove',
]);

const dbModule: any = new Proxy({init, shutdown} as any, {
  get(target, prop) {
    if (prop === 'init') return init;
    if (prop === 'shutdown') return shutdown;
    if (prop === 'db') return shared.db;
    if (typeof prop === 'string' &&
        (prop in shared.wrappers || WRAPPER_NAMES.has(prop))) {
      return shared.wrappers[prop];
    }
    return (target as any)[prop];
  },
  set(target, prop, value) {
    if (prop === 'db') { shared.db = value; return true; }
    if (typeof prop === 'string' &&
        (prop in shared.wrappers || WRAPPER_NAMES.has(prop))) {
      // Tests stub wrapper methods by assigning `dbModule.set = ...` —
      // route those writes into shared.wrappers so subsequent reads
      // (including from other module records of this same source) see
      // the stub.
      shared.wrappers[prop] = value;
      return true;
    }
    (target as any)[prop] = value;
    return true;
  },
  has(target, prop) {
    if (prop === 'db' || prop === 'init' || prop === 'shutdown') return true;
    if (typeof prop === 'string' &&
        (prop in shared.wrappers || WRAPPER_NAMES.has(prop))) return true;
    return prop in (target as any);
  },
});

export default dbModule;
