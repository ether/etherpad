# fast-kv Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `ueberdb2` npm package with `@samtv12345/ueberdb-rs`, a Rust-native drop-in replacement, and remove the npm database driver packages that are now bundled in Rust.

**Architecture:** Direct package swap with three small inline fixes — drop the logger constructor arg, call `metrics()` as a method instead of accessing it as a property, and remove the `DatabaseType` type import. No compatibility shim or abstraction layer is added.

**Tech Stack:** TypeScript, napi-rs native Node.js binding (`@samtv12345/ueberdb-rs`)

---

## File Map

| File | Change |
|------|--------|
| `src/package.json` | Remove `ueberdb2`, 10 driver packages, `rusty-store-kv`; add `@samtv12345/ueberdb-rs` |
| `src/node/db/DB.ts` | Swap import; drop logger arg; fix `metrics` property → method |
| `src/node/db/Pad.ts` | Swap import |
| `src/node/utils/ImportEtherpad.ts` | Swap import |

---

### Task 1: Update package.json

**Files:**
- Modify: `src/package.json`

- [ ] **Step 1: Remove ueberdb2 and bundled driver packages, add fast-kv**

  In `src/package.json`, make the following changes to the `"dependencies"` object:

  Remove these keys:
  ```
  "@elastic/elasticsearch"
  "cassandra-driver"
  "mongodb"
  "mssql"
  "mysql2"
  "nano"
  "pg"
  "redis"
  "rethinkdb"
  "rusty-store-kv"
  "surrealdb"
  "ueberdb2"
  ```

  Add this key (place it alphabetically, e.g. after `"async"`):
  ```json
  "@samtv12345/ueberdb-rs": "^0.1.1",
  ```

- [ ] **Step 2: Install updated dependencies**

  Run from the `src/` directory:
  ```bash
  cd src && npm install
  ```

  Expected: installs without errors. `node_modules/@samtv12345/ueberdb-rs` exists.

- [ ] **Step 3: Commit**

  ```bash
  git add src/package.json src/package-lock.json
  git commit -m "chore(deps): replace ueberdb2 with @samtv12345/ueberdb-rs, remove bundled driver packages"
  ```

---

### Task 2: Update DB.ts

**Files:**
- Modify: `src/node/db/DB.ts`

This file has three changes:
1. Import swap + remove `DatabaseType`
2. Drop 4th constructor arg (logger)
3. `db.metrics` property → `db.metrics()` method call (2 places)

- [ ] **Step 1: Apply all changes to DB.ts**

  Replace the entire file content with:

  ```typescript
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
    await exports.db.init();
    const m = exports.db.metrics();
    if (m != null) {
      for (const [metric, value] of Object.entries(m)) {
        if (typeof value !== 'number') continue;
        stats.gauge(`ueberdb_${metric}`, () => exports.db.metrics()[metric]);
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
  ```

- [ ] **Step 2: Run TypeScript check**

  ```bash
  cd src && npm run ts-check 2>&1 | head -40
  ```

  Expected: no errors referencing `DB.ts`, `ueberdb2`, or `DatabaseType`.

- [ ] **Step 3: Commit**

  ```bash
  git add src/node/db/DB.ts
  git commit -m "refactor(db): migrate DB.ts from ueberdb2 to @samtv12345/ueberdb-rs"
  ```

---

### Task 3: Update Pad.ts

**Files:**
- Modify: `src/node/db/Pad.ts` (line 2)

- [ ] **Step 1: Swap import in Pad.ts**

  Find line 2 in `src/node/db/Pad.ts`:
  ```typescript
  import {Database} from "ueberdb2";
  ```
  Replace with:
  ```typescript
  import {Database} from '@samtv12345/ueberdb-rs';
  ```

- [ ] **Step 2: Run TypeScript check**

  ```bash
  cd src && npm run ts-check 2>&1 | head -40
  ```

  Expected: no errors referencing `Pad.ts` or `ueberdb2`.

- [ ] **Step 3: Commit**

  ```bash
  git add src/node/db/Pad.ts
  git commit -m "refactor(db): update Pad.ts import to @samtv12345/ueberdb-rs"
  ```

---

### Task 4: Update ImportEtherpad.ts

**Files:**
- Modify: `src/node/utils/ImportEtherpad.ts` (line 29)

- [ ] **Step 1: Swap import in ImportEtherpad.ts**

  Find line 29 in `src/node/utils/ImportEtherpad.ts`:
  ```typescript
  import {Database} from 'ueberdb2';
  ```
  Replace with:
  ```typescript
  import {Database} from '@samtv12345/ueberdb-rs';
  ```

- [ ] **Step 2: Run TypeScript check**

  ```bash
  cd src && npm run ts-check 2>&1 | head -40
  ```

  Expected: no errors referencing `ImportEtherpad.ts` or `ueberdb2`. Zero `ueberdb2` references remaining in the codebase.

- [ ] **Step 3: Verify no remaining ueberdb2 references**

  ```bash
  grep -r "ueberdb2" src/node src/package.json
  ```

  Expected: no output (zero matches).

- [ ] **Step 4: Commit**

  ```bash
  git add src/node/utils/ImportEtherpad.ts
  git commit -m "refactor(db): update ImportEtherpad.ts import to @samtv12345/ueberdb-rs"
  ```

---

### Task 5: Smoke test

- [ ] **Step 1: Run backend tests**

  ```bash
  cd src && npm test 2>&1 | tail -30
  ```

  Expected: test suite passes (or same failures as before the migration — no new failures introduced by the package swap).

- [ ] **Step 2: Start the server and verify DB initialises**

  ```bash
  cd src && npm run dev 2>&1 | head -30
  ```

  Expected: server starts, log line contains something like `[ueberDB]` or similar without throwing on `db.init()`.
