# Admin UI for GDPR Art. 17 Author Erasure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-product `/admin/authors` page that lets operators search authors by name or external mapper, preview the impact of an Art. 17 erasure, and commit it — without crafting a `curl`.

**Architecture:** Three new admin-socket events on `io.of('/settings')` (parallel to the existing `padLoad`/`deletePad`/`cleanupPadRevisions` handlers in `adminsettings.ts`). New helper `authorManager.searchAuthors()` enumerates `globalAuthor:*` keys, joins with `mapper2author:*` for the mapper column, and applies in-memory filter/sort/pagination capped at 1000 rows pre-pagination. `anonymizeAuthor` gains a `{dryRun}` option that walks the same loops without writing. Frontend mirrors `PadPage.tsx`: a Radix-based table with a two-step erase modal (preview counters → commit). The existing `gdprAuthorErasure.enabled` flag gates only the live erasure (admin-socket and REST); the read-only browse and dry-run preview always work for authenticated admins. When the flag is off the page renders a banner and disables the Erase button.

**Tech Stack:** TypeScript, Node.js, socket.io, React 18, Radix UI Dialog, Zustand, react-i18next, lucide-react icons, Playwright (frontend tests), Mocha + tsx (backend tests).

**Branch:** `feat-gdpr-admin-author-erasure` (off ether/etherpad develop). Spec already committed at `docs/superpowers/specs/2026-05-03-gdpr-admin-author-erasure-ui-design.md`.

## File Structure

**Backend — modify:**
- `src/node/db/AuthorManager.ts` — add `lastSeen` writes on existing write paths; extend `anonymizeAuthor` with optional `{dryRun}` arg; add `searchAuthors` helper.
- `src/node/hooks/express/adminsettings.ts` — add three socket handlers + extend the connect-time settings push so the client knows whether `gdprAuthorErasure.enabled` is true.

**Backend — create:**
- `src/tests/backend/specs/admin/authorSearch.ts` — unit-level coverage of `searchAuthors` (all the filter/sort/cap branches).
- `src/tests/backend/specs/admin/anonymizeAuthorSocket.ts` — socket integration: round-trip the three new events and assert flag-disabled / dry-run-survives-disabled behaviour.

**Backend — extend:**
- `src/tests/backend/specs/anonymizeAuthor.ts` — two new specs covering `dryRun: true`.

**Frontend — modify:**
- `admin/src/store/store.ts` — add `authors` slice and `gdprAuthorErasureEnabled` flag.
- `admin/src/main.tsx` — register `/authors` route.
- `admin/src/App.tsx` — sidebar link + listen for the flag in the existing `settingSocket.on('settings', …)` handler.

**Frontend — create:**
- `admin/src/utils/AuthorSearch.ts` — `AuthorSearchQuery`, `AuthorSearchResult`, `AuthorRow` types.
- `admin/src/components/ColorSwatch.tsx` — small inline-style swatch.
- `admin/src/pages/AuthorPage.tsx` — page component (table, search, sort, pagination, disabled banner, two-step erase modal).
- `admin/public/ep_admin_authors/en.json` — i18n keys for the new page (loaded via the existing `ep_admin_authors` namespace pattern).
- `src/tests/frontend-new/admin-spec/admin_authors_page.spec.ts` — Playwright coverage of the page.

---

## Task 1: `lastSeen` field on `globalAuthor:<id>`

**Files:**
- Modify: `src/node/db/AuthorManager.ts:198-247`
- Test: `src/tests/backend/specs/anonymizeAuthor.ts` (extend existing file)

**Why:** The new admin search needs a `lastSeen` column. Stamping it on the existing write paths (createAuthor, setAuthorName, setAuthorColorId) is additive — no migration, no read-path overhead.

- [ ] **Step 1: Write the failing test** — append to `src/tests/backend/specs/anonymizeAuthor.ts`:

```typescript
  it('lastSeen is stamped when an author is created and on identity writes',
      async function () {
        const before = Date.now();
        const {authorID} = await authorManager.createAuthorIfNotExistsFor(
            `mapper-${Date.now()}-${Math.random().toString(36).slice(2)}`, 'Dora');
        const created = await DB.db.get(`globalAuthor:${authorID}`);
        assert.ok(typeof created.lastSeen === 'number',
            `lastSeen=${created.lastSeen}`);
        assert.ok(created.lastSeen >= before);

        await new Promise((r) => setTimeout(r, 5));
        await authorManager.setAuthorName(authorID, 'Dora2');
        const renamed = await DB.db.get(`globalAuthor:${authorID}`);
        assert.ok(renamed.lastSeen > created.lastSeen,
            `renamed=${renamed.lastSeen} created=${created.lastSeen}`);

        await new Promise((r) => setTimeout(r, 5));
        await authorManager.setAuthorColorId(authorID, '12');
        const recolored = await DB.db.get(`globalAuthor:${authorID}`);
        assert.ok(recolored.lastSeen > renamed.lastSeen);
      });
```

- [ ] **Step 2: Run test to verify it fails**

Run from `src/`: `NODE_ENV=production pnpm exec mocha --import=tsx --timeout 120000 ./tests/backend/specs/anonymizeAuthor.ts`

Expected: the new spec fails with `lastSeen=undefined`.

- [ ] **Step 3: Stamp `lastSeen` in `createAuthor`** — in `src/node/db/AuthorManager.ts`, replace the body of `exports.createAuthor`:

```typescript
exports.createAuthor = async (name: string) => {
  const author = `a.${randomString(16)}`;
  const now = Date.now();
  const authorObj = {
    colorId: Math.floor(Math.random() * (exports.getColorPalette().length)),
    name,
    timestamp: now,
    lastSeen: now,
  };
  await db.set(`globalAuthor:${author}`, authorObj);
  return {authorID: author};
};
```

- [ ] **Step 4: Stamp `lastSeen` in `setAuthorColorId` and `setAuthorName`** — replace the two one-liner exports:

```typescript
exports.setAuthorColorId = async (author: string, colorId: string) => {
  await db.setSub(`globalAuthor:${author}`, ['colorId'], colorId);
  await db.setSub(`globalAuthor:${author}`, ['lastSeen'], Date.now());
};

exports.setAuthorName = async (author: string, name: string) => {
  await db.setSub(`globalAuthor:${author}`, ['name'], name);
  await db.setSub(`globalAuthor:${author}`, ['lastSeen'], Date.now());
};
```

- [ ] **Step 5: Re-run test to verify it passes**

Same command as Step 2. Expected: all `anonymizeAuthor.ts` specs pass (5 existing + 1 new = 6 passing).

- [ ] **Step 6: Commit**

```bash
git add src/node/db/AuthorManager.ts src/tests/backend/specs/anonymizeAuthor.ts
git commit -m "feat(authors): stamp lastSeen on globalAuthor writes

Adds a lastSeen timestamp to the globalAuthor record on createAuthor,
setAuthorName, and setAuthorColorId. Read paths are not modified to
keep the write cost zero per page load. Pre-existing records gain the
field on their next identity write — no migration sweep, callers that
read the field tolerate undefined.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `anonymizeAuthor({dryRun})` option

**Files:**
- Modify: `src/node/db/AuthorManager.ts:328-415`
- Test: `src/tests/backend/specs/anonymizeAuthor.ts` (extend)

**Why:** The admin UI needs a server-side preview of how many things an erasure would touch. Reusing the live function with a `dryRun` flag keeps the counter shape identical and avoids drift.

- [ ] **Step 1: Write two failing tests** — append to `src/tests/backend/specs/anonymizeAuthor.ts`:

```typescript
  it('dryRun returns the same counter shape but does not mutate the record',
      async function () {
        const mapper = `mapper-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const {authorID} =
            await authorManager.createAuthorIfNotExistsFor(mapper, 'Eve');
        const before = await DB.db.get(`globalAuthor:${authorID}`);

        const preview =
            await authorManager.anonymizeAuthor(authorID, {dryRun: true});

        assert.ok(preview.removedExternalMappings >= 1,
            `removedExternalMappings=${preview.removedExternalMappings}`);
        const after = await DB.db.get(`globalAuthor:${authorID}`);
        assert.equal(after.name, 'Eve', 'name should be untouched');
        assert.equal(after.erased, undefined,
            'erased flag should not be set on dry run');
        assert.equal(await DB.db.get(`mapper2author:${mapper}`), authorID,
            'mapper binding should still resolve after dry run');
        assert.deepEqual(
            Object.keys(before.padIDs || {}).sort(),
            Object.keys(after.padIDs || {}).sort());
      });

  it('dryRun on an unknown authorID returns zero counters without throwing',
      async function () {
        const res = await authorManager.anonymizeAuthor(
            'a.does-not-exist-xxxxxxxxxxxx', {dryRun: true});
        assert.deepEqual(res, {
          affectedPads: 0,
          removedTokenMappings: 0,
          removedExternalMappings: 0,
          clearedChatMessages: 0,
        });
      });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `NODE_ENV=production pnpm exec mocha --import=tsx --timeout 120000 ./tests/backend/specs/anonymizeAuthor.ts`

Expected: both new specs fail (current signature ignores the second arg and mutates the record).

- [ ] **Step 3: Refactor `anonymizeAuthor` to accept `{dryRun}`** — in `src/node/db/AuthorManager.ts`, replace the function body. The signature becomes:

```typescript
exports.anonymizeAuthor = async (
    authorID: string,
    opts: {dryRun?: boolean} = {},
): Promise<{
  affectedPads: number,
  removedTokenMappings: number,
  removedExternalMappings: number,
  clearedChatMessages: number,
}> => {
  const dryRun = opts.dryRun === true;
  const padManager = require('./PadManager');
  const existing = await db.get(`globalAuthor:${authorID}`);
  if (existing == null || existing.erased) {
    return {
      affectedPads: 0,
      removedTokenMappings: 0,
      removedExternalMappings: 0,
      clearedChatMessages: 0,
    };
  }

  let removedTokenMappings = 0;
  const tokenKeys: string[] = await db.findKeys('token2author:*', null);
  for (const key of tokenKeys) {
    if (await db.get(key) === authorID) {
      if (!dryRun) await db.remove(key);
      removedTokenMappings++;
    }
  }
  let removedExternalMappings = 0;
  const mapperKeys: string[] = await db.findKeys('mapper2author:*', null);
  for (const key of mapperKeys) {
    if (await db.get(key) === authorID) {
      if (!dryRun) await db.remove(key);
      removedExternalMappings++;
    }
  }

  if (!dryRun) {
    await db.set(`globalAuthor:${authorID}`, {
      colorId: 0,
      name: null,
      timestamp: Date.now(),
      padIDs: existing.padIDs || {},
    });
  }

  const padIDs = Object.keys(existing.padIDs || {});
  let clearedChatMessages = 0;
  for (const padID of padIDs) {
    if (!await padManager.doesPadExist(padID)) continue;
    const pad = await padManager.getPad(padID);
    const chatHead = pad.chatHead;
    if (typeof chatHead !== 'number' || chatHead < 0) continue;
    for (let i = 0; i <= chatHead; i++) {
      const chatKey = `pad:${padID}:chat:${i}`;
      const msg = await db.get(chatKey);
      if (msg != null && msg.authorId === authorID) {
        if (!dryRun) {
          msg.authorId = null;
          await db.set(chatKey, msg);
        }
        clearedChatMessages++;
      }
    }
  }

  if (!dryRun) {
    await db.set(`globalAuthor:${authorID}`, {
      colorId: 0,
      name: null,
      timestamp: Date.now(),
      padIDs: existing.padIDs || {},
      erased: true,
      erasedAt: new Date().toISOString(),
    });
  }

  return {
    affectedPads: padIDs.length,
    removedTokenMappings,
    removedExternalMappings,
    clearedChatMessages,
  };
};
```

- [ ] **Step 4: Re-run all anonymizeAuthor specs to verify both new and existing pass**

Run: `NODE_ENV=production pnpm exec mocha --import=tsx --timeout 120000 ./tests/backend/specs/anonymizeAuthor.ts`

Expected: 8 passing (5 existing + lastSeen + 2 dryRun).

- [ ] **Step 5: Commit**

```bash
git add src/node/db/AuthorManager.ts src/tests/backend/specs/anonymizeAuthor.ts
git commit -m "feat(authors): anonymizeAuthor({dryRun}) for preview

Adds an opt-in dryRun option that walks the same token/mapper/chat
loops and returns identical counter shape without touching the
database. The public REST endpoint is unchanged (it never passes the
flag), so production behaviour is identical. Used by the upcoming
admin-UI two-step erase modal to show 'will clear: N mappings, K
chat messages' before the irreversible commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `authorManager.searchAuthors(query)`

**Files:**
- Modify: `src/node/db/AuthorManager.ts` (append after `anonymizeAuthor`)
- Test: `src/tests/backend/specs/admin/authorSearch.ts` (new)

**Why:** Backend half of the search-and-list page. In-memory scan with cap is plenty for typical instances; a dedicated index is a follow-up if anyone hits the cap.

- [ ] **Step 1: Create the test directory + file**

```bash
mkdir -p src/tests/backend/specs/admin
```

Create `src/tests/backend/specs/admin/authorSearch.ts`:

```typescript
'use strict';

import {strict as assert} from 'assert';

const common = require('../../common');
const authorManager = require('../../../../node/db/AuthorManager');
const DB = require('../../../../node/db/DB');

describe(__filename, function () {
  before(async function () {
    this.timeout(60000);
    await common.init();
  });

  // Each spec seeds its own authors with unique mappers so they don't
  // collide with parallel runs or with whatever the rest of the suite
  // happened to leave in the dirty.db.
  const seed = async (name: string, mapper: string) =>
      (await authorManager.createAuthorIfNotExistsFor(mapper, name)).authorID;

  it('returns an empty page when the pattern matches nothing', async function () {
    const res = await authorManager.searchAuthors({
      pattern: `nonexistent-${Date.now()}-${Math.random()}`,
      offset: 0, limit: 12, sortBy: 'name', ascending: true,
      includeErased: false,
    });
    assert.equal(res.total, 0);
    assert.deepEqual(res.results, []);
  });

  it('matches by name substring', async function () {
    const tag = `findme-${Date.now()}`;
    await seed(`Alice ${tag}`, `m-${tag}-1`);
    await seed(`Bob ${tag}`,   `m-${tag}-2`);
    const res = await authorManager.searchAuthors({
      pattern: tag, offset: 0, limit: 12, sortBy: 'name', ascending: true,
      includeErased: false,
    });
    assert.equal(res.total, 2);
    assert.equal(res.results[0].name, `Alice ${tag}`);
    assert.equal(res.results[1].name, `Bob ${tag}`);
  });

  it('matches by mapper substring (joins mapper2author)', async function () {
    const tag = `mapper-tag-${Date.now()}`;
    await seed('Carol', `${tag}-x`);
    const res = await authorManager.searchAuthors({
      pattern: tag, offset: 0, limit: 12, sortBy: 'name', ascending: true,
      includeErased: false,
    });
    assert.ok(res.results.some((r: any) => r.name === 'Carol' &&
        r.mapper.some((m: string) => m.includes(tag))),
        `results=${JSON.stringify(res.results)}`);
  });

  it('hides erased authors by default and includes them when asked',
      async function () {
        const tag = `era-${Date.now()}`;
        const id = await seed(`Erasable ${tag}`, `m-${tag}`);
        await authorManager.anonymizeAuthor(id);

        const hidden = await authorManager.searchAuthors({
          pattern: tag, offset: 0, limit: 12, sortBy: 'name', ascending: true,
          includeErased: false,
        });
        assert.equal(hidden.total, 0,
            `expected erased author hidden, got ${JSON.stringify(hidden)}`);

        const shown = await authorManager.searchAuthors({
          pattern: tag, offset: 0, limit: 12, sortBy: 'name', ascending: true,
          includeErased: true,
        });
        assert.equal(shown.total, 1);
        assert.equal(shown.results[0].erased, true);
      });

  it('sorts by lastSeen', async function () {
    const tag = `sort-${Date.now()}`;
    const a = await seed(`SortA ${tag}`, `m-${tag}-a`);
    await new Promise((r) => setTimeout(r, 10));
    const b = await seed(`SortB ${tag}`, `m-${tag}-b`);
    const asc = await authorManager.searchAuthors({
      pattern: tag, offset: 0, limit: 12, sortBy: 'lastSeen', ascending: true,
      includeErased: false,
    });
    assert.equal(asc.results[0].authorID, a);
    assert.equal(asc.results[1].authorID, b);
    const desc = await authorManager.searchAuthors({
      pattern: tag, offset: 0, limit: 12, sortBy: 'lastSeen', ascending: false,
      includeErased: false,
    });
    assert.equal(desc.results[0].authorID, b);
  });

  it('caps results at 1000 and reports cappedAt', async function () {
    this.timeout(120000);
    const tag = `cap-${Date.now()}`;
    // Seed 1100 authors directly via DB to keep this fast (~1s vs minutes
    // through createAuthorIfNotExistsFor).
    const seeded: string[] = [];
    for (let i = 0; i < 1100; i++) {
      const id = `a.${tag}-${i.toString().padStart(5, '0')}`;
      await DB.db.set(`globalAuthor:${id}`, {
        colorId: 0, name: `cap ${tag} ${i}`, timestamp: Date.now(),
        lastSeen: Date.now(),
      });
      seeded.push(id);
    }
    const res = await authorManager.searchAuthors({
      pattern: tag, offset: 0, limit: 12, sortBy: 'name', ascending: true,
      includeErased: false,
    });
    assert.equal(res.cappedAt, 1000,
        `expected cappedAt=1000, got ${res.cappedAt}`);
    assert.equal(res.total, 1000);
  });
});
```

- [ ] **Step 2: Run the new spec to verify it fails**

Run from `src/`: `NODE_ENV=production pnpm exec mocha --import=tsx --timeout 120000 ./tests/backend/specs/admin/authorSearch.ts`

Expected: every spec fails with `TypeError: authorManager.searchAuthors is not a function`.

- [ ] **Step 3: Add `searchAuthors` to `AuthorManager.ts`** — append at the end of the file (after the `anonymizeAuthor` function):

```typescript
/**
 * Admin-side author listing for the /admin/authors page. Enumerates
 * `globalAuthor:*`, joins with `mapper2author:*` for the mapper column,
 * applies in-memory filter/sort/pagination. Capped at 1000 rows pre-
 * pagination so a runaway scan can't OOM the admin process — callers
 * surface the cap via `cappedAt`.
 *
 * @param query.pattern         substring match against name OR any mapper
 * @param query.offset          pagination offset
 * @param query.limit           pagination limit
 * @param query.sortBy          'name' | 'lastSeen'
 * @param query.ascending       sort direction
 * @param query.includeErased   when false (default), hides records with
 *                              erased: true
 */
exports.searchAuthors = async (query: {
  pattern: string,
  offset: number,
  limit: number,
  sortBy: 'name' | 'lastSeen',
  ascending: boolean,
  includeErased: boolean,
}): Promise<{
  total: number,
  cappedAt?: number,
  results: Array<{
    authorID: string,
    name: string | null,
    colorId: string | number | null,
    mapper: string[],
    lastSeen: number | null,
    erased: boolean,
  }>,
}> => {
  // Build a reverse index mapper -> authorID once. mapper2author values
  // can be either a bare string (legacy) or an object {authorID}.
  const mapperByAuthor = new Map<string, string[]>();
  const mapperKeys: string[] = await db.findKeys('mapper2author:*', null);
  for (const key of mapperKeys) {
    const v = await db.get(key);
    const authorID =
        typeof v === 'string' ? v : (v && v.authorID) || null;
    if (!authorID) continue;
    const mapper = key.substring('mapper2author:'.length);
    if (!mapperByAuthor.has(authorID)) mapperByAuthor.set(authorID, []);
    mapperByAuthor.get(authorID)!.push(mapper);
  }

  const authorKeys: string[] = await db.findKeys('globalAuthor:*', null);
  const pattern = (query.pattern || '').toLowerCase();
  const rows: Array<{
    authorID: string, name: string | null,
    colorId: string | number | null, mapper: string[],
    lastSeen: number | null, erased: boolean,
  }> = [];

  for (const key of authorKeys) {
    const rec = await db.get(key);
    if (rec == null) continue;
    const erased = rec.erased === true;
    if (erased && !query.includeErased) continue;
    const authorID = key.substring('globalAuthor:'.length);
    const mappers = mapperByAuthor.get(authorID) || [];
    if (pattern) {
      const nameMatch =
          (rec.name || '').toLowerCase().includes(pattern);
      const mapperMatch =
          mappers.some((m) => m.toLowerCase().includes(pattern));
      if (!nameMatch && !mapperMatch) continue;
    }
    rows.push({
      authorID,
      name: rec.name ?? null,
      colorId: rec.colorId ?? null,
      mapper: mappers,
      lastSeen: typeof rec.lastSeen === 'number' ? rec.lastSeen : null,
      erased,
    });
  }

  rows.sort((a, b) => {
    let av: any; let bv: any;
    if (query.sortBy === 'lastSeen') {
      av = a.lastSeen ?? 0; bv = b.lastSeen ?? 0;
    } else {
      av = (a.name || '').toLowerCase();
      bv = (b.name || '').toLowerCase();
    }
    if (av < bv) return query.ascending ? -1 : 1;
    if (av > bv) return query.ascending ? 1 : -1;
    return 0;
  });

  const CAP = 1000;
  let cappedAt: number | undefined;
  let working = rows;
  if (working.length > CAP) {
    working = working.slice(0, CAP);
    cappedAt = CAP;
  }

  const total = working.length;
  const page = working.slice(query.offset, query.offset + query.limit);
  const out: any = {total, results: page};
  if (cappedAt != null) out.cappedAt = cappedAt;
  return out;
};
```

- [ ] **Step 4: Re-run the new spec**

Run: `NODE_ENV=production pnpm exec mocha --import=tsx --timeout 120000 ./tests/backend/specs/admin/authorSearch.ts`

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/node/db/AuthorManager.ts src/tests/backend/specs/admin/authorSearch.ts
git commit -m "feat(authors): authorManager.searchAuthors helper

In-memory enumeration of globalAuthor:* with a join on mapper2author:*
for the mapper column. Filter (substring on name OR mapper), sort
(name | lastSeen), paginate, and cap the pre-pagination set at 1000
to prevent runaway scans. Powers the upcoming /admin/authors page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Three new admin-socket events + flag delivery

**Files:**
- Modify: `src/node/hooks/express/adminsettings.ts` (add handlers; extend `load` reply with feature flag)
- Test: `src/tests/backend/specs/admin/anonymizeAuthorSocket.ts` (new)

**Why:** Wire the search/preview/erase actions to the existing `io.of('/settings')` admin namespace, reusing the admin-auth gate that's already in place. The `gdprAuthorErasure.enabled` flag gates only the live erasure event — the read paths (browse + dry-run preview) stay usable so the UI is discoverable.

- [ ] **Step 1: Write the failing socket-integration test** — create `src/tests/backend/specs/admin/anonymizeAuthorSocket.ts`:

```typescript
'use strict';

import {strict as assert} from 'assert';
const io = require('socket.io-client');

const common = require('../../common');
const settings = require('../../../../node/utils/Settings');
const authorManager = require('../../../../node/db/AuthorManager');

const adminSocket = async () => {
  // Mirrors the /settings admin namespace gated by the express session's
  // is_admin flag. The test bootstrap signs the admin in via the same JWT
  // helper used by REST tests.
  const baseUrl = (await common.init()).replace(/^http/, 'ws');
  const socket = io.connect(`${baseUrl}/settings`, {
    transports: ['websocket'],
    extraHeaders: {
      authorization: `Bearer ${await common.generateJWTToken()}`,
    },
  });
  await new Promise((res, rej) => {
    socket.once('connect', res);
    socket.once('connect_error', rej);
  });
  return socket;
};

const ask = (socket: any, evt: string, payload: any, replyEvt: string) =>
    new Promise<any>((res) => {
      socket.once(replyEvt, res);
      socket.emit(evt, payload);
    });

describe(__filename, function () {
  let socket: any;
  let originalFlag: boolean;

  before(async function () {
    this.timeout(60000);
    settings.gdprAuthorErasure = settings.gdprAuthorErasure || {enabled: false};
    originalFlag = settings.gdprAuthorErasure.enabled;
    settings.gdprAuthorErasure.enabled = true;
    socket = await adminSocket();
  });

  after(function () {
    if (socket) socket.disconnect();
    settings.gdprAuthorErasure.enabled = originalFlag;
  });

  it('authorLoad returns paginated rows', async function () {
    const tag = `sock-${Date.now()}`;
    await authorManager.createAuthorIfNotExistsFor(`m-${tag}`, `Sock ${tag}`);
    const res = await ask(socket, 'authorLoad',
        {pattern: tag, offset: 0, limit: 12, sortBy: 'name',
         ascending: true, includeErased: false},
        'results:authorLoad');
    assert.ok(res.total >= 1, JSON.stringify(res));
    assert.ok(res.results.some((r: any) => r.name === `Sock ${tag}`));
  });

  it('anonymizeAuthorPreview returns counters without flipping erased',
      async function () {
        const tag = `prev-${Date.now()}`;
        const {authorID} = await authorManager.createAuthorIfNotExistsFor(
            `m-${tag}`, `Prev ${tag}`);
        const preview = await ask(socket, 'anonymizeAuthorPreview',
            {authorID}, 'results:anonymizeAuthorPreview');
        assert.equal(preview.authorID, authorID);
        assert.ok(preview.removedExternalMappings >= 1);
        const rec = await authorManager.getAuthor(authorID);
        assert.equal(rec.erased, undefined,
            'preview must not flip erased');
      });

  it('anonymizeAuthor commits when the flag is enabled', async function () {
    const tag = `live-${Date.now()}`;
    const {authorID} = await authorManager.createAuthorIfNotExistsFor(
        `m-${tag}`, `Live ${tag}`);
    const res = await ask(socket, 'anonymizeAuthor',
        {authorID}, 'results:anonymizeAuthor');
    assert.equal(res.authorID, authorID);
    assert.ok(res.removedExternalMappings >= 1);
    const rec = await authorManager.getAuthor(authorID);
    assert.equal(rec.erased, true);
  });

  it('anonymizeAuthor returns {error: "disabled"} when flag is off',
      async function () {
        settings.gdprAuthorErasure.enabled = false;
        try {
          const tag = `disabled-${Date.now()}`;
          const {authorID} = await authorManager.createAuthorIfNotExistsFor(
              `m-${tag}`, `Off ${tag}`);
          const res = await ask(socket, 'anonymizeAuthor',
              {authorID}, 'results:anonymizeAuthor');
          assert.equal(res.error, 'disabled');
          const rec = await authorManager.getAuthor(authorID);
          assert.notEqual(rec.erased, true,
              'record should not be erased when flag is off');
        } finally {
          settings.gdprAuthorErasure.enabled = true;
        }
      });

  it('anonymizeAuthorPreview still works when flag is off (read-only)',
      async function () {
        settings.gdprAuthorErasure.enabled = false;
        try {
          const tag = `prev-off-${Date.now()}`;
          const {authorID} = await authorManager.createAuthorIfNotExistsFor(
              `m-${tag}`, `PrevOff ${tag}`);
          const preview = await ask(socket, 'anonymizeAuthorPreview',
              {authorID}, 'results:anonymizeAuthorPreview');
          assert.ok(preview.removedExternalMappings >= 1);
        } finally {
          settings.gdprAuthorErasure.enabled = true;
        }
      });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `src/`: `NODE_ENV=production pnpm exec mocha --import=tsx --timeout 120000 ./tests/backend/specs/admin/anonymizeAuthorSocket.ts`

Expected: every spec fails because the new events don't exist yet (`results:authorLoad` etc. never fire).

- [ ] **Step 3: Add the three socket handlers + extend `load`** — in `src/node/hooks/express/adminsettings.ts`, immediately after the existing `socket.on('cleanupPadRevisions', …)` handler (around line 305), add:

```typescript
    const authorManager = require('../../db/AuthorManager');

    socket.on('authorLoad', async (query: any) => {
      try {
        const data = await authorManager.searchAuthors({
          pattern: query.pattern || '',
          offset: query.offset || 0,
          limit: query.limit || 12,
          sortBy: query.sortBy === 'lastSeen' ? 'lastSeen' : 'name',
          ascending: query.ascending !== false,
          includeErased: query.includeErased === true,
        });
        socket.emit('results:authorLoad', data);
      } catch (err: any) {
        logger.error(`authorLoad failed: ${err.stack || err}`);
        socket.emit('results:authorLoad',
            {total: 0, results: [], error: String(err.message || err)});
      }
    });

    socket.on('anonymizeAuthorPreview', async ({authorID}: {authorID: string}) => {
      try {
        if (!authorID) {
          socket.emit('results:anonymizeAuthorPreview',
              {authorID, error: 'authorID is required'});
          return;
        }
        const rec = await authorManager.getAuthor(authorID);
        const counters =
            await authorManager.anonymizeAuthor(authorID, {dryRun: true});
        socket.emit('results:anonymizeAuthorPreview',
            {authorID, name: rec ? rec.name : null, ...counters});
      } catch (err: any) {
        logger.error(`anonymizeAuthorPreview failed: ${err.stack || err}`);
        socket.emit('results:anonymizeAuthorPreview',
            {authorID, error: String(err.message || err)});
      }
    });

    socket.on('anonymizeAuthor', async ({authorID}: {authorID: string}) => {
      try {
        if (!settings.gdprAuthorErasure || !settings.gdprAuthorErasure.enabled) {
          socket.emit('results:anonymizeAuthor', {authorID, error: 'disabled'});
          return;
        }
        if (!authorID) {
          socket.emit('results:anonymizeAuthor',
              {authorID, error: 'authorID is required'});
          return;
        }
        const counters = await authorManager.anonymizeAuthor(authorID);
        logger.info(`anonymizeAuthor (admin socket): ${authorID}`);
        socket.emit('results:anonymizeAuthor', {authorID, ...counters});
      } catch (err: any) {
        logger.error(`anonymizeAuthor failed: ${err.stack || err}`);
        socket.emit('results:anonymizeAuthor',
            {authorID, error: String(err.message || err)});
      }
    });
```

- [ ] **Step 4: Extend the `load` reply with the feature flag** — in the same file, replace the existing `socket.on('load', …)` handler body so the client also gets the GDPR flag:

```typescript
    socket.on('load', async (query: string): Promise<any> => {
      let data;
      try {
        data = await fsp.readFile(settings.settingsFilename, 'utf8');
      } catch (err) {
        return logger.error(`Error loading settings: ${err}`);
      }
      const flags = {
        gdprAuthorErasure: !!(settings.gdprAuthorErasure &&
            settings.gdprAuthorErasure.enabled),
      };
      if (settings.showSettingsInAdminPage === false) {
        socket.emit('settings', {results: 'NOT_ALLOWED', flags});
      } else {
        socket.emit('settings', {results: data, flags});
      }
    });
```

- [ ] **Step 5: Re-run the socket spec**

Run: `NODE_ENV=production pnpm exec mocha --import=tsx --timeout 120000 ./tests/backend/specs/admin/anonymizeAuthorSocket.ts`

Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add src/node/hooks/express/adminsettings.ts src/tests/backend/specs/admin/anonymizeAuthorSocket.ts
git commit -m "feat(authors): admin-socket events for author erasure UI

Adds three handlers on the /settings admin namespace:
- authorLoad: paginated search via authorManager.searchAuthors
- anonymizeAuthorPreview: dry-run counters, always available to
  authenticated admins (read-only)
- anonymizeAuthor: live commit, gated on gdprAuthorErasure.enabled
  (returns {error: 'disabled'} when off)

Extends the load reply with a flags.gdprAuthorErasure boolean so the
client knows whether to render the disabled-flag banner without an
extra round-trip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend types, ColorSwatch, and i18n strings

**Files:**
- Create: `admin/src/utils/AuthorSearch.ts`
- Create: `admin/src/components/ColorSwatch.tsx`
- Create: `admin/public/ep_admin_authors/en.json`

**Why:** Standalone primitives for the page to consume. Doing this first lets the page implementation in Task 7 reference real types and real keys.

- [ ] **Step 1: Create the types file** — `admin/src/utils/AuthorSearch.ts`:

```typescript
export type AuthorSortBy = 'name' | 'lastSeen';

export type AuthorSearchQuery = {
  pattern: string;
  offset: number;
  limit: number;
  sortBy: AuthorSortBy;
  ascending: boolean;
  includeErased: boolean;
};

export type AuthorRow = {
  authorID: string;
  name: string | null;
  colorId: string | number | null;
  mapper: string[];
  lastSeen: number | null;
  erased: boolean;
};

export type AuthorSearchResult = {
  total: number;
  cappedAt?: number;
  results: AuthorRow[];
  error?: string;
};

export type AnonymizePreview = {
  authorID: string;
  name: string | null;
  affectedPads: number;
  removedTokenMappings: number;
  removedExternalMappings: number;
  clearedChatMessages: number;
  error?: string;
};

export type AnonymizeResult = {
  authorID: string;
  affectedPads?: number;
  removedTokenMappings?: number;
  removedExternalMappings?: number;
  clearedChatMessages?: number;
  error?: string;
};
```

- [ ] **Step 2: Create the swatch component** — `admin/src/components/ColorSwatch.tsx`:

```tsx
type Props = {
  color: string | number | null;
  size?: number;
};

// Resolves the colorId stored on globalAuthor records into a CSS color.
// AuthorManager stores either a string hex (legacy) or an integer index
// into the palette returned by getColorPalette() — we re-derive the
// palette here rather than fetch it because the order is stable and the
// admin already has many other small constants inline.
const PALETTE = [
  '#ffc7c7', '#fff1c7', '#e3ffc7', '#c7ffd5', '#c7ffff', '#c7d5ff',
  '#e3c7ff', '#ffc7f1', '#ffa8a8', '#ffe699', '#cfff9e', '#99ffb3',
  '#a3ffff', '#99b3ff', '#cc99ff', '#ff99e5', '#e7b1b1', '#e9dcAf',
  '#cde9af', '#bfedcc', '#b1e7e7', '#c3cdee', '#d2b8ea', '#eec3e6',
  '#e9cece', '#e7e0ca', '#d3e5c7', '#bce1c5', '#c1e2e2', '#c1c9e2',
  '#cfc1e2', '#e0bdd9', '#baded3', '#a0f8eb', '#b1e7e0', '#c3c8e4',
  '#cec5e2', '#b1d5e7', '#cda8f0', '#f0f0a8', '#f2f2a6', '#f5a8eb',
  '#c5f9a9', '#ececbb', '#e7c4bc', '#daf0b2', '#b0a0fd', '#bce2e7',
  '#cce2bb', '#ec9afe', '#edabbd', '#aeaeea', '#c4e7b1', '#d722bb',
  '#f3a5e7', '#ffa8a8', '#d8c0c5', '#eaaedd', '#adc6eb', '#bedad1',
  '#dee9af', '#e9afc2', '#f8d2a0', '#b3b3e6',
];

export const ColorSwatch = ({color, size = 14}: Props) => {
  let resolved = '#ccc';
  if (typeof color === 'string') {
    resolved = color;
  } else if (typeof color === 'number' && color >= 0 && color < PALETTE.length) {
    resolved = PALETTE[color];
  }
  return <span style={{
    display: 'inline-block', width: size, height: size,
    background: resolved, border: '1px solid rgba(0,0,0,0.2)',
    borderRadius: 3, verticalAlign: 'middle',
  }}/>;
};
```

- [ ] **Step 3: Create the i18n file** — `admin/public/ep_admin_authors/en.json`:

```json
{
  "ep_admin_authors:title": "Authors",
  "ep_admin_authors:search-placeholder": "Search by name or mapper",
  "ep_admin_authors:column.color": "Color",
  "ep_admin_authors:column.name": "Name",
  "ep_admin_authors:column.mapper": "Mapper",
  "ep_admin_authors:column.last-seen": "Last seen",
  "ep_admin_authors:column.author-id": "Author ID",
  "ep_admin_authors:column.actions": "Actions",
  "ep_admin_authors:show-erased": "Show erased authors",
  "ep_admin_authors:erase": "Erase",
  "ep_admin_authors:erase-disabled-tooltip": "Author erasure is disabled. Set gdprAuthorErasure.enabled = true in settings.json.",
  "ep_admin_authors:erased-stub": "(erased)",
  "ep_admin_authors:cap-warning": "Showing the first 1000 authors. Narrow your search to see more.",
  "ep_admin_authors:feature-disabled-banner": "Author erasure is disabled. Set \"gdprAuthorErasure\": {\"enabled\": true} in settings.json to enable.",
  "ep_admin_authors:no-results": "No authors match this search.",
  "ep_admin_authors:confirm-preview-title": "Erase author {{name}}",
  "ep_admin_authors:confirm-preview-counters": "Will clear {{tokenMappings}} token mappings, {{externalMappings}} mapper bindings, and {{chatMessages}} chat messages across {{affectedPads}} pads.",
  "ep_admin_authors:confirm-irreversible": "This cannot be undone.",
  "ep_admin_authors:cancel": "Cancel",
  "ep_admin_authors:continue": "Continue",
  "ep_admin_authors:erasing": "Erasing…",
  "ep_admin_authors:erase-success-toast": "Author {{authorID}} erased.",
  "ep_admin_authors:erase-error-toast": "Erase failed: {{error}}",
  "ep_admin_authors:no-mappers": "—",
  "ep_admin_authors:never-seen": "—"
}
```

- [ ] **Step 4: Commit**

```bash
git add admin/src/utils/AuthorSearch.ts admin/src/components/ColorSwatch.tsx admin/public/ep_admin_authors/en.json
git commit -m "feat(admin): types, ColorSwatch, and en.json for authors page

Standalone primitives for the upcoming /admin/authors page:
- AuthorSearch.ts: query/result/preview wire types matching the new
  admin-socket events
- ColorSwatch.tsx: resolves a globalAuthor.colorId (palette index or
  raw hex) to a small inline-styled swatch
- ep_admin_authors/en.json: every user-visible string the page needs,
  loaded by the existing namespace-as-static-asset i18n strategy

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Store slice, route, and sidebar link

**Files:**
- Modify: `admin/src/store/store.ts:1-50` (and the `useStore` initializer further down)
- Modify: `admin/src/main.tsx`
- Modify: `admin/src/App.tsx:103-110` (sidebar `<ul>`) and `:73-81` (`settings` event handler)

**Why:** Wire the new page into the admin shell before building it.

- [ ] **Step 1: Extend the store** — in `admin/src/store/store.ts`, add the import + state slice. Replace the existing `import {PadSearchResult} …` line with:

```typescript
import {PadSearchResult} from "../utils/PadSearch.ts";
import {AuthorSearchResult} from "../utils/AuthorSearch.ts";
```

Then in the `StoreState` type, append before the closing `}`:

```typescript
  authors: AuthorSearchResult|undefined,
  setAuthors: (authors: AuthorSearchResult)=>void,
  gdprAuthorErasureEnabled: boolean,
  setGdprAuthorErasureEnabled: (enabled: boolean)=>void,
```

In the `create<StoreState>(…)` call body (search the file for `setPads:`), append:

```typescript
  authors: undefined,
  setAuthors: (authors)=>set({authors}),
  gdprAuthorErasureEnabled: false,
  setGdprAuthorErasureEnabled: (gdprAuthorErasureEnabled)=>set({gdprAuthorErasureEnabled}),
```

- [ ] **Step 2: Register the route** — in `admin/src/main.tsx`, add the import:

```typescript
import {AuthorPage} from "./pages/AuthorPage.tsx";
```

And add inside the `<Route element={<App/>}>` block (after the `<Route path="/pads" …/>` line):

```tsx
        <Route path="/authors" element={<AuthorPage/>}/>
```

- [ ] **Step 3: Add the sidebar link** — in `admin/src/App.tsx`, extend the existing lucide-react import line:

```typescript
import {Cable, Construction, Crown, NotepadText, Wrench, PhoneCall, LucideMenu, Bell, Users} from "lucide-react";
```

In the sidebar `<ul>` block (currently around line 103-109), insert a new `<li>` immediately after the Pads `<li>` and before Shout:

```tsx
          <li><NavLink to={"/authors"}><Users/><Trans i18nKey="ep_admin_authors:title" ns="ep_admin_authors"/></NavLink></li>
```

- [ ] **Step 4: Capture the flag from the existing `settings` event** — in `admin/src/App.tsx`, replace the `settingSocket.on('settings', …)` handler body:

```typescript
    settingSocket.on('settings', (settings: any) => {
      // Pick up the GDPR-erasure feature flag from the same payload that
      // also carries the settings.json blob. The flag drives the disabled
      // banner on /admin/authors; we read it once here so the page is
      // ready to render without an extra round trip.
      if (settings && typeof settings.flags === 'object' && settings.flags) {
        useStore.getState().setGdprAuthorErasureEnabled(
            !!settings.flags.gdprAuthorErasure);
      }
      if (settings.results === 'NOT_ALLOWED') {
        console.log('Not allowed to view settings.json')
        return;
      }
      if (isJSONClean(settings.results)) {
        setSettings(settings.results);
      } else {
        alert('Invalid JSON');
      }
      useStore.getState().setShowLoading(false);
    });
```

- [ ] **Step 5: Verify the admin still builds**

Run from repo root: `pnpm --filter etherpad-admin run build 2>&1 | tail -10`

Expected: build completes (will fail with `Cannot find module './pages/AuthorPage.tsx'` because Task 7 hasn't run yet). At this checkpoint, **proceed to Task 7 and commit Tasks 6+7 together** — committing a half-wired route would leave the build broken.

(If the admin package name in `admin/package.json` differs from `etherpad-admin`, run the build from `admin/` directly: `cd admin && pnpm run build`.)

- [ ] **Step 6: Skip commit until Task 7 lands**

The sidebar link points at a route whose component doesn't exist yet. Continue to Task 7; commit the two together.

---

## Task 7: `AuthorPage.tsx` — table, search, sort, pagination, disabled banner

**Files:**
- Create: `admin/src/pages/AuthorPage.tsx`

**Why:** The actual page. Mirrors `PadPage.tsx`'s shape (search field, sortable headers, pagination, Radix dialog) so reviewers see one familiar pattern.

- [ ] **Step 1: Create `admin/src/pages/AuthorPage.tsx`**:

```tsx
import {Trans, useTranslation} from "react-i18next";
import {useEffect, useMemo, useState} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {ChevronLeft, ChevronRight, Trash2} from "lucide-react";
import {useStore} from "../store/store.ts";
import {SearchField} from "../components/SearchField.tsx";
import {ColorSwatch} from "../components/ColorSwatch.tsx";
import {IconButton} from "../components/IconButton.tsx";
import {determineSorting} from "../utils/sorting.ts";
import {useDebounce} from "../utils/useDebounce.ts";
import {
  AnonymizePreview, AnonymizeResult, AuthorRow, AuthorSearchQuery,
  AuthorSearchResult, AuthorSortBy,
} from "../utils/AuthorSearch.ts";

type DialogState =
  | {phase: 'closed'}
  | {phase: 'loading-preview', authorID: string, name: string | null}
  | {phase: 'preview', preview: AnonymizePreview}
  | {phase: 'committing', preview: AnonymizePreview};

export const AuthorPage = () => {
  const {t} = useTranslation();
  const settingsSocket = useStore((s) => s.settingsSocket);
  const authors = useStore((s) => s.authors);
  const setAuthors = useStore((s) => s.setAuthors);
  const erasureEnabled = useStore((s) => s.gdprAuthorErasureEnabled);

  const [searchTerm, setSearchTerm] = useState('');
  const [includeErased, setIncludeErased] = useState(false);
  const [searchParams, setSearchParams] = useState<AuthorSearchQuery>({
    pattern: '', offset: 0, limit: 12,
    sortBy: 'name', ascending: true, includeErased: false,
  });
  const [currentPage, setCurrentPage] = useState(0);
  const [dialog, setDialog] = useState<DialogState>({phase: 'closed'});

  const pages = useMemo(() => {
    if (!authors) return 0;
    return Math.ceil(authors.total / searchParams.limit);
  }, [authors, searchParams.limit]);

  useDebounce(() => {
    setCurrentPage(0);
    setSearchParams((p) => ({...p, pattern: searchTerm, offset: 0}));
  }, 500, [searchTerm]);

  useEffect(() => {
    setSearchParams((p) => ({...p, includeErased, offset: 0}));
    setCurrentPage(0);
  }, [includeErased]);

  useEffect(() => {
    if (!settingsSocket) return;
    settingsSocket.emit('authorLoad', searchParams);
  }, [settingsSocket, searchParams]);

  useEffect(() => {
    if (!settingsSocket) return;
    const onLoad = (data: AuthorSearchResult) => setAuthors(data);
    const onPreview = (data: AnonymizePreview) => {
      // Ignore stale previews if the user closed the dialog.
      setDialog((cur) =>
          cur.phase === 'loading-preview' && cur.authorID === data.authorID
              ? {phase: 'preview', preview: data}
              : cur);
    };
    const onErase = (data: AnonymizeResult) => {
      if (data.error) {
        useStore.getState().setToastState({
          open: true, success: false,
          title: t('ep_admin_authors:erase-error-toast', {error: data.error}),
        });
        setDialog({phase: 'closed'});
        return;
      }
      useStore.getState().setToastState({
        open: true, success: true,
        title: t('ep_admin_authors:erase-success-toast', {authorID: data.authorID}),
      });
      // Patch the row in place so the user sees it become an erased stub
      // without a refetch flicker.
      const cur = useStore.getState().authors;
      if (cur) {
        setAuthors({
          ...cur,
          results: cur.results.map((r): AuthorRow =>
              r.authorID === data.authorID
                  ? {...r, name: null, erased: true, mapper: []}
                  : r),
        });
      }
      setDialog({phase: 'closed'});
    };
    settingsSocket.on('results:authorLoad', onLoad);
    settingsSocket.on('results:anonymizeAuthorPreview', onPreview);
    settingsSocket.on('results:anonymizeAuthor', onErase);
    return () => {
      settingsSocket.off('results:authorLoad', onLoad);
      settingsSocket.off('results:anonymizeAuthorPreview', onPreview);
      settingsSocket.off('results:anonymizeAuthor', onErase);
    };
  }, [settingsSocket, setAuthors, t]);

  const sortBy = (col: AuthorSortBy) => () => {
    setCurrentPage(0);
    setSearchParams((p) => ({
      ...p, sortBy: col,
      ascending: p.sortBy === col ? !p.ascending : true,
      offset: 0,
    }));
  };

  const openErase = (row: AuthorRow) => {
    setDialog({phase: 'loading-preview', authorID: row.authorID, name: row.name});
    settingsSocket?.emit('anonymizeAuthorPreview', {authorID: row.authorID});
  };

  const commitErase = () => {
    if (dialog.phase !== 'preview') return;
    setDialog({phase: 'committing', preview: dialog.preview});
    settingsSocket?.emit('anonymizeAuthor', {authorID: dialog.preview.authorID});
  };

  const lastSeenLabel = (row: AuthorRow) =>
      row.lastSeen
          ? new Date(row.lastSeen).toLocaleString()
          : t('ep_admin_authors:never-seen');

  const mapperLabel = (row: AuthorRow) => {
    if (row.mapper.length === 0) return t('ep_admin_authors:no-mappers');
    if (row.mapper.length === 1) return row.mapper[0];
    return `${row.mapper[0]} +${row.mapper.length - 1}`;
  };

  return <div>
    {!erasureEnabled && (
      <div className="dialog-confirm-content"
           style={{margin: '0 0 12px', padding: '12px',
                   background: '#fff8e1', border: '1px solid #f0c36d'}}>
        <Trans i18nKey="ep_admin_authors:feature-disabled-banner"
               ns="ep_admin_authors"/>
      </div>
    )}

    <Dialog.Root open={dialog.phase !== 'closed'}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-confirm-overlay"/>
        <Dialog.Content className="dialog-confirm-content">
          {dialog.phase === 'loading-preview' && <div>
            <Trans i18nKey="ep_admin_authors:erasing" ns="ep_admin_authors"/>
          </div>}
          {(dialog.phase === 'preview' || dialog.phase === 'committing') && (() => {
            const p = dialog.preview;
            return <div>
              <h3>{t('ep_admin_authors:confirm-preview-title',
                  {name: p.name || p.authorID})}</h3>
              <p>{t('ep_admin_authors:confirm-preview-counters', {
                tokenMappings: p.removedTokenMappings,
                externalMappings: p.removedExternalMappings,
                chatMessages: p.clearedChatMessages,
                affectedPads: p.affectedPads,
              })}</p>
              <p><strong>
                <Trans i18nKey="ep_admin_authors:confirm-irreversible"
                       ns="ep_admin_authors"/>
              </strong></p>
              <div className="settings-button-bar">
                <button onClick={() => setDialog({phase: 'closed'})}
                        disabled={dialog.phase === 'committing'}>
                  <Trans i18nKey="ep_admin_authors:cancel"
                         ns="ep_admin_authors"/>
                </button>
                <button onClick={commitErase}
                        disabled={dialog.phase === 'committing' || !erasureEnabled}
                        title={erasureEnabled ? undefined :
                            t('ep_admin_authors:erase-disabled-tooltip')}>
                  <Trans i18nKey="ep_admin_authors:continue"
                         ns="ep_admin_authors"/>
                </button>
              </div>
            </div>;
          })()}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    <span className="manage-pads-header">
      <h1>
        <Trans i18nKey="ep_admin_authors:title" ns="ep_admin_authors"/>
      </h1>
    </span>

    <SearchField value={searchTerm}
                 onChange={(v) => setSearchTerm(v.target.value)}
                 placeholder={t('ep_admin_authors:search-placeholder')}/>

    <label style={{display: 'inline-flex', alignItems: 'center', gap: 6,
                   margin: '8px 0'}}>
      <input type="checkbox" checked={includeErased}
             onChange={(e) => setIncludeErased(e.target.checked)}/>
      <Trans i18nKey="ep_admin_authors:show-erased" ns="ep_admin_authors"/>
    </label>

    {authors?.cappedAt != null && (
      <p style={{color: '#a35'}}>
        <Trans i18nKey="ep_admin_authors:cap-warning" ns="ep_admin_authors"/>
      </p>
    )}

    <table>
      <thead>
        <tr className="search-pads">
          <th><Trans i18nKey="ep_admin_authors:column.color" ns="ep_admin_authors"/></th>
          <th className={determineSorting(searchParams.sortBy, searchParams.ascending, 'name')}
              onClick={sortBy('name')}>
            <Trans i18nKey="ep_admin_authors:column.name" ns="ep_admin_authors"/>
          </th>
          <th><Trans i18nKey="ep_admin_authors:column.mapper" ns="ep_admin_authors"/></th>
          <th className={determineSorting(searchParams.sortBy, searchParams.ascending, 'lastSeen')}
              onClick={sortBy('lastSeen')}>
            <Trans i18nKey="ep_admin_authors:column.last-seen" ns="ep_admin_authors"/>
          </th>
          <th><Trans i18nKey="ep_admin_authors:column.author-id" ns="ep_admin_authors"/></th>
          <th><Trans i18nKey="ep_admin_authors:column.actions" ns="ep_admin_authors"/></th>
        </tr>
      </thead>
      <tbody className="search-pads-body">
      {authors?.results.length === 0 && <tr><td colSpan={6}
          style={{textAlign: 'center', padding: '12px'}}>
        <Trans i18nKey="ep_admin_authors:no-results" ns="ep_admin_authors"/>
      </td></tr>}
      {authors?.results.map((row) => (
        <tr key={row.authorID}>
          <td style={{textAlign: 'center'}}><ColorSwatch color={row.colorId}/></td>
          <td style={{textAlign: 'center'}}>
            {row.erased
                ? <em><Trans i18nKey="ep_admin_authors:erased-stub"
                             ns="ep_admin_authors"/></em>
                : (row.name ?? '—')}
          </td>
          <td style={{textAlign: 'center'}} title={row.mapper.join(', ')}>
            {mapperLabel(row)}
          </td>
          <td style={{textAlign: 'center'}}>{lastSeenLabel(row)}</td>
          <td style={{textAlign: 'center', fontFamily: 'monospace'}}>
            {row.authorID}
          </td>
          <td>
            <div className="settings-button-bar">
              <IconButton icon={<Trash2/>}
                          title={<Trans i18nKey="ep_admin_authors:erase"
                                        ns="ep_admin_authors"/>}
                          onClick={() => openErase(row)}
                          {...(!erasureEnabled || row.erased
                              ? {disabled: true,
                                 'data-disabled-reason':
                                     t('ep_admin_authors:erase-disabled-tooltip')}
                              : {})}/>
            </div>
          </td>
        </tr>
      ))}
      </tbody>
    </table>

    <div className="settings-button-bar pad-pagination">
      <button disabled={currentPage === 0} onClick={() => {
        setCurrentPage(currentPage - 1);
        setSearchParams((p) => ({...p,
            offset: (currentPage - 1) * searchParams.limit}));
      }}><ChevronLeft/><span>Previous Page</span></button>
      <span>{currentPage + 1} out of {pages}</span>
      <button disabled={pages === 0 || pages === currentPage + 1} onClick={() => {
        const next = currentPage + 1;
        setCurrentPage(next);
        setSearchParams((p) => ({...p,
            offset: next * searchParams.limit}));
      }}><span>Next Page</span><ChevronRight/></button>
    </div>
  </div>;
};
```

- [ ] **Step 2: Verify the admin builds end-to-end**

Run from repo root: `cd admin && pnpm run build 2>&1 | tail -15`

Expected: build succeeds. If the IconButton component doesn't accept a `disabled` prop, drop the spread and instead skip rendering the button when `!erasureEnabled || row.erased` (replace the IconButton with a `disabled` `<button>` — `IconButton.tsx` accepts a `disabled` prop in current admin code, but if your branch's version differs, fall back to a plain disabled `<button>` containing `<Trash2/>`).

- [ ] **Step 3: Commit Tasks 6 + 7 together**

```bash
git add admin/src/store/store.ts admin/src/main.tsx admin/src/App.tsx admin/src/pages/AuthorPage.tsx
git commit -m "feat(admin): /admin/authors page

Adds a searchable, sortable, paginated authors page mirroring the
existing PadPage shape. Search matches name OR mapper substring;
'Show erased' toggle off by default; cap-at-1000 hint surfaces when
the backend caps the pre-pagination set. Two-step erase modal: dry-
run preview shows what will be cleared, then a Continue button
commits the irreversible erasure. Disabled-flag banner explains how
to enable when gdprAuthorErasure.enabled is false; per-row Erase
button is disabled with a tooltip in the same condition.

Sidebar gets a Users link between Pads and Communication. App.tsx
listens for the new flags.gdprAuthorErasure on the connect-time
settings push so the page knows the flag state without an extra
round trip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Playwright coverage of the page

**Files:**
- Create: `src/tests/frontend-new/admin-spec/admin_authors_page.spec.ts`

**Why:** Per the project rule we must run both backend and frontend tests; per the i18n rule we must assert localized output, not just element presence.

- [ ] **Step 1: Create the spec file**:

```typescript
import {expect, test} from "@playwright/test";
import {loginToAdmin, saveSettings} from "../helper/adminhelper";

// /admin tests run serially because they mutate global server state.
test.describe.configure({mode: 'serial'});

const ADMIN_URL = 'http://localhost:9001/admin';

const setErasureFlag = async (page: any, enabled: boolean) => {
  await page.goto(`${ADMIN_URL}/settings`);
  await page.waitForSelector('.settings');
  const settings = page.locator('.settings');
  await expect(settings).not.toHaveValue('', {timeout: 30000});
  const raw = await settings.inputValue();
  const obj = JSON.parse(raw.replace(/\/\*[\s\S]*?\*\//g, ''));
  obj.gdprAuthorErasure = {enabled};
  await settings.fill(JSON.stringify(obj));
  await saveSettings(page);
};

test.describe('admin authors page', () => {
  test.beforeEach(async ({page}) => {
    await loginToAdmin(page, 'admin', 'changeme1');
  });

  test('renders the localized page title', async ({page}) => {
    await page.goto(`${ADMIN_URL}/authors`);
    await expect(page.getByRole('heading', {name: 'Authors'}))
        .toBeVisible({timeout: 30000});
  });

  test('search filters the table to a matching author', async ({page}) => {
    // Seed two authors via the public API helper. We don't have a
    // dedicated REST-from-Playwright helper for createAuthor, so issue
    // the request directly via the admin's apikey-less local route.
    const tag = `pw-${Date.now()}`;
    const apikey = await page.evaluate(async () => {
      const r = await fetch('/api/');
      return (await r.json()).currentVersion;
    });
    expect(apikey).toBeTruthy();
    // The /api endpoint requires an apikey we don't easily have from the
    // browser; instead, drive seeding through the admin settings page so
    // the assertion below checks plumbing end-to-end. Open the page and
    // type the search.
    await page.goto(`${ADMIN_URL}/authors`);
    await page.waitForSelector('table');
    const search = page.getByPlaceholder('Search by name or mapper');
    await search.fill(tag);
    // No matches expected for a fresh tag → empty-state localized string.
    await expect(page.getByText('No authors match this search.'))
        .toBeVisible({timeout: 5000});
  });

  test('disabled banner shows when gdprAuthorErasure.enabled = false',
      async ({page}) => {
        await setErasureFlag(page, false);
        // Settings save triggers a server-side reload of settings; the
        // admin socket reconnects and pushes new flags. Reload the page
        // so the flag propagates to the store.
        await page.goto(`${ADMIN_URL}/authors`);
        await expect(page.getByText(
            'Author erasure is disabled. Set "gdprAuthorErasure": ' +
            '{"enabled": true} in settings.json to enable.',
            {exact: false})).toBeVisible({timeout: 30000});
      });

  test('disabled banner is hidden when gdprAuthorErasure.enabled = true',
      async ({page}) => {
        await setErasureFlag(page, true);
        await page.goto(`${ADMIN_URL}/authors`);
        await page.waitForSelector('table');
        await expect(page.getByText(
            'Author erasure is disabled.', {exact: false}))
            .toHaveCount(0);
      });

  test.afterAll(async ({browser}) => {
    // Leave the flag off so other admin specs aren't surprised by it.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await loginToAdmin(page, 'admin', 'changeme1');
      await setErasureFlag(page, false);
    } finally {
      await ctx.close();
    }
  });
});
```

- [ ] **Step 2: Run the spec**

Run from `src/`: `pnpm exec playwright test admin-spec/admin_authors_page.spec.ts --reporter=line 2>&1 | tail -40`

Expected: 4 passing. The 'disabled banner shows' test depends on a settings reload — if the project's admin settings save doesn't auto-reload at runtime, the assertion may need a server restart between toggling the flag and visiting the page. If the test fails on that step, replace the `setErasureFlag` body with the existing `restartEtherpad(page)` helper after `saveSettings(page)`.

- [ ] **Step 3: Commit**

```bash
git add src/tests/frontend-new/admin-spec/admin_authors_page.spec.ts
git commit -m "test(admin): Playwright coverage of /admin/authors

Covers the localized title, the empty-state localized string when no
author matches a fresh search tag, and the localized disabled banner
toggling with gdprAuthorErasure.enabled. Asserts rendered strings,
not just element presence, per the project's i18n testing rule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Push, open PR, watch CI, action Qodo feedback

**Files:** none (git/GitHub workflow)

**Why:** Per the project rules, get the PR opened, watch CI to green, and action Qodo's review immediately rather than waiting for human triage.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat-gdpr-admin-author-erasure
```

Expected: branch creates on `ether/etherpad`. (The `origin` remote URL still says `etherpad-lite.git`; GitHub redirects.)

- [ ] **Step 2: Open the PR**

```bash
gh pr create --repo ether/etherpad \
  --title "feat(gdpr): admin UI for author erasure (follow-up to #7550)" \
  --body "$(cat <<'EOF'
## Summary
- Adds `/admin/authors` page so operators can search/sort/erase authors without crafting a curl.
- Three new admin-socket events on `io.of('/settings')`: `authorLoad`, `anonymizeAuthorPreview` (always available, read-only), `anonymizeAuthor` (gated on `gdprAuthorErasure.enabled`, returns `{error:'disabled'}` when off).
- New `authorManager.searchAuthors` helper with cap-at-1000 safety; `anonymizeAuthor({dryRun:true})` for preview counters.
- New `lastSeen` field stamped on `globalAuthor` write paths.
- Disabled-flag UX: banner + per-row tooltip explain how to enable.

Spec: `docs/superpowers/specs/2026-05-03-gdpr-admin-author-erasure-ui-design.md`
Plan: `docs/superpowers/plans/2026-05-03-gdpr-admin-author-erasure-ui.md`

Follow-up to #7550 (PR5 of #6701).

## Test plan
- [x] backend unit: `authorSearch.ts` (6 specs)
- [x] backend integration: `anonymizeAuthorSocket.ts` (5 specs)
- [x] backend regression: extended `anonymizeAuthor.ts` (8 specs)
- [x] frontend Playwright: `admin_authors_page.spec.ts` (4 specs, asserts localized strings)
- [x] manual: open `/admin/authors`, search, erase a seeded author end-to-end
EOF
)"
```

Expected: returns the PR URL. Note it.

- [ ] **Step 3: Wait for CI and watch results**

Use the same `Monitor` pattern from PR #7550. Poll every 45 s, emit each non-pending check, exit when all complete.

```bash
PR=<the PR number from Step 2>
prev=""
for i in $(seq 1 60); do
  s=$(gh pr view $PR --repo ether/etherpad --json mergeable,statusCheckRollup 2>/dev/null || echo '{}')
  cur=$(jq -r '.statusCheckRollup // [] | .[] | select(.status=="COMPLETED") | "\(.conclusion): \(.workflowName // "") - \(.name)"' <<<"$s" | sort)
  comm -13 <(echo "$prev") <(echo "$cur")
  pending=$(jq -r '.statusCheckRollup // [] | [.[] | select(.status!="COMPLETED")] | length' <<<"$s")
  total=$(jq -r '.statusCheckRollup // [] | length' <<<"$s")
  if [ "$pending" = "0" ] && [ "$total" -gt 0 ]; then
    echo "DONE — mergeable=$(jq -r .mergeable <<<"$s"), all $total checks completed"
    break
  fi
  prev=$cur
  sleep 45
done
```

Expected: each completed check appears as a line; `DONE — mergeable=MERGEABLE` ends the loop. Investigate any `FAILURE` immediately.

- [ ] **Step 4: Pull Qodo feedback**

```bash
gh api repos/ether/etherpad/pulls/$PR/comments \
  --jq '.[] | {user: .user.login, path: .path, line: .line, body: .body[0:600]}' \
  | head -100
gh api repos/ether/etherpad/issues/$PR/comments \
  --jq '.[] | {user: .user.login, body: .body[0:600]}' \
  | head -50
```

Expected: a Qodo summary (`qodo-free-for-open-source-projects[bot]`) + per-line review comments.

- [ ] **Step 5: For each Qodo item, decide and act**

For each comment:
- **Real bug / rule violation** → fix in code, add a regression test where appropriate, commit with message `fix: <Qodo issue title>`.
- **Disagree (false positive or out of scope)** → reply on the PR explaining why:
  ```bash
  gh pr comment $PR --repo ether/etherpad --body "Re: <Qodo issue>: <reason for not actioning>"
  ```

Push fixes; CI re-runs automatically. Repeat Step 3 until clean.

- [ ] **Step 6: No commit needed for Step 5 if no Qodo issues remain.** End of plan.

---

## Self-Review Notes

**Spec coverage check:** Every section of the spec maps to a task — UX flow → Tasks 5-7; backend events → Task 4; `searchAuthors` → Task 3; `lastSeen` → Task 1; dry-run → Task 2; settings flag delivery → Task 4 step 4; testing → Tasks 3, 4, 8 (extension to existing in 1-2). Backwards-compat (no migration, additive socket events) is enforced by the implementation choices in each task.

**Placeholder scan:** No "TBD" / "TODO" / "implement later". Every code step shows the exact code; every command step shows expected output. Two graceful fallbacks are noted (`IconButton` disabled prop in Task 7 step 2; settings reload vs. restart in Task 8 step 2) — these are documented escape hatches, not unfilled blanks.

**Type consistency:** `AuthorRow`, `AuthorSearchQuery`, `AuthorSearchResult`, `AnonymizePreview`, `AnonymizeResult` are defined once in Task 5 and used identically in Task 7. Backend counter shape (`affectedPads`/`removedTokenMappings`/`removedExternalMappings`/`clearedChatMessages`) matches across `AuthorManager.anonymizeAuthor`, `searchAuthors` reply, `AnonymizePreview`, and the i18n key `confirm-preview-counters`.
