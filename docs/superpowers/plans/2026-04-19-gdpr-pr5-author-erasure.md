# GDPR PR5 — Author Erasure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GDPR Art. 17 "right to be forgotten" for an anonymous author — zero the display identity on `globalAuthor:<id>`, delete the `token2author:*` and `mapper2author:*` bindings that resolve a real person to the opaque authorID, and null-out chat authorship for messages the author posted. Pad text, revision history, and attribute pools are kept intact.

**Architecture:** A new `authorManager.anonymizeAuthor(authorID)` that owns the full sweep, a thin `API.ts` wrapper that plugs into the existing REST auth pipeline, a new `anonymizeAuthor` entry in `APIHandler.version['1.3.1']`. Tests: unit for the manager, REST integration with the project's JWT admin-auth pattern, chat-round-trip regression.

**Tech Stack:** TypeScript, ueberdb (via the existing `DB.db.findKeys` helper), Mocha + supertest for backend tests.

---

## File Structure

**Modified:**
- `src/node/db/AuthorManager.ts` — add `anonymizeAuthor`
- `src/node/db/API.ts` — expose it on the programmatic API
- `src/node/handler/APIHandler.ts` — register version `1.3.1`, bump `latestApiVersion`
- `doc/privacy.md` — new "Right to erasure" section (file was created by PR4 #7549; we append)

**Created:**
- `src/tests/backend/specs/anonymizeAuthor.ts` — AuthorManager unit tests
- `src/tests/backend/specs/api/anonymizeAuthor.ts` — REST integration tests

---

## Task 1: `anonymizeAuthor` on AuthorManager

**Files:**
- Modify: `src/node/db/AuthorManager.ts` — append the exported function

- [ ] **Step 1: Read `AuthorManager.ts` to confirm existing exports**

Run: `grep -n "exports\." src/node/db/AuthorManager.ts`

Look for `exports.listPadsOfAuthor`, `exports.addPad`, `exports.removePad`. They're the closest neighbours and share the `padIDs` traversal idea.

- [ ] **Step 2: Import `db` and `padManager` already in file — just append the function**

At the bottom of `src/node/db/AuthorManager.ts`:

```typescript
/**
 * GDPR Art. 17: anonymise an author. Zeroes the display identity on
 * globalAuthor:<authorID>, deletes the token/mapper bindings that link a
 * person to this authorID, and nulls authorship on chat messages they
 * posted. Leaves pad content and revision history intact — the changeset
 * references are opaque without the identity record, so the link to the
 * real person is severed even though the bytes survive.
 *
 * Idempotent: once `erased: true` is set on the author record, subsequent
 * calls short-circuit and return zero counters.
 */
exports.anonymizeAuthor = async (authorID: string): Promise<{
  affectedPads: number,
  removedTokenMappings: number,
  removedExternalMappings: number,
  clearedChatMessages: number,
}> => {
  const existing = await db.get(`globalAuthor:${authorID}`);
  if (existing == null || existing.erased) {
    return {
      affectedPads: 0,
      removedTokenMappings: 0,
      removedExternalMappings: 0,
      clearedChatMessages: 0,
    };
  }

  // Drop the token/mapper mappings first, before zeroing the display
  // record, so a concurrent getAuthorId() can no longer resolve this
  // author through its old bindings mid-erasure.
  let removedTokenMappings = 0;
  const tokenKeys = await db.findKeys('token2author:*', null);
  for (const key of tokenKeys) {
    if (await db.get(key) === authorID) {
      await db.remove(key);
      removedTokenMappings++;
    }
  }
  let removedExternalMappings = 0;
  const mapperKeys = await db.findKeys('mapper2author:*', null);
  for (const key of mapperKeys) {
    if (await db.get(key) === authorID) {
      await db.remove(key);
      removedExternalMappings++;
    }
  }

  // Zero the display identity but keep padIDs so future maintenance (or a
  // pad-delete batch) can still find the set of pads this authorID touched.
  await db.set(`globalAuthor:${authorID}`, {
    colorId: 0,
    name: null,
    timestamp: Date.now(),
    padIDs: existing.padIDs || {},
    erased: true,
    erasedAt: new Date().toISOString(),
  });

  // Null authorship on chat messages the author posted.
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
        msg.authorId = null;
        await db.set(chatKey, msg);
        clearedChatMessages++;
      }
    }
  }

  return {
    affectedPads: padIDs.length,
    removedTokenMappings,
    removedExternalMappings,
    clearedChatMessages,
  };
};
```

- [ ] **Step 3: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/node/db/AuthorManager.ts
git commit -m "feat(gdpr): AuthorManager.anonymizeAuthor — Art. 17 erasure"
```

---

## Task 2: Unit tests for `anonymizeAuthor`

**Files:**
- Create: `src/tests/backend/specs/anonymizeAuthor.ts`

- [ ] **Step 1: Write the test**

```typescript
'use strict';

import {strict as assert} from 'assert';

const common = require('../common');
const authorManager = require('../../../node/db/AuthorManager');
const db = require('../../../node/db/DB');

describe(__filename, function () {
  before(async function () {
    this.timeout(60000);
    await common.init();
  });

  it('zeroes the display identity on globalAuthor:<id>', async function () {
    const {authorID} = await authorManager.createAuthorIfNotExistsFor(
        `mapper-${Date.now()}-${Math.random()}`, 'Alice');
    assert.equal(await authorManager.getAuthorName(authorID), 'Alice');

    const res = await authorManager.anonymizeAuthor(authorID);
    assert.ok(res.removedExternalMappings >= 1);

    const record = await db.db.get(`globalAuthor:${authorID}`);
    assert.equal(record.name, null);
    assert.equal(record.colorId, 0);
    assert.equal(record.erased, true);
    assert.ok(typeof record.erasedAt === 'string');
  });

  it('drops token2author and mapper2author mappings pointing at the author',
      async function () {
        const mapper = `mapper-${Date.now()}-${Math.random()}`;
        const {authorID} = await authorManager.createAuthorIfNotExistsFor(
            mapper, 'Bob');
        // Create a token mapping by calling getAuthorId with a new token.
        const token = `t.${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
        // getAuthorId takes (token, user); first call seeds token2author:<token>.
        await authorManager.getAuthorId(token, {});
        // We need a token that resolves to *this* authorID. Do it by making
        // the token's first use deterministic: set token2author:<token> ourselves.
        await db.db.set(`token2author:${token}`, authorID);

        assert.equal(await db.db.get(`token2author:${token}`), authorID);
        assert.equal(await db.db.get(`mapper2author:${mapper}`), authorID);

        const res = await authorManager.anonymizeAuthor(authorID);
        assert.ok(res.removedTokenMappings >= 1);
        assert.ok(res.removedExternalMappings >= 1);
        assert.equal(await db.db.get(`token2author:${token}`), null);
        assert.equal(await db.db.get(`mapper2author:${mapper}`), null);
      });

  it('is idempotent — second call returns zero counters', async function () {
    const {authorID} = await authorManager.createAuthorIfNotExistsFor(
        `mapper-${Date.now()}-${Math.random()}`, 'Carol');
    await authorManager.anonymizeAuthor(authorID);
    const second = await authorManager.anonymizeAuthor(authorID);
    assert.deepEqual(second, {
      affectedPads: 0,
      removedTokenMappings: 0,
      removedExternalMappings: 0,
      clearedChatMessages: 0,
    });
  });

  it('returns zero counters for an unknown authorID', async function () {
    const res = await authorManager.anonymizeAuthor('a.does-not-exist');
    assert.deepEqual(res, {
      affectedPads: 0,
      removedTokenMappings: 0,
      removedExternalMappings: 0,
      clearedChatMessages: 0,
    });
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter ep_etherpad-lite exec mocha --require tsx/cjs tests/backend/specs/anonymizeAuthor.ts --timeout 60000`
Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tests/backend/specs/anonymizeAuthor.ts
git commit -m "test(gdpr): AuthorManager.anonymizeAuthor — identity + mappings + idempotence"
```

---

## Task 3: Expose on REST API

**Files:**
- Modify: `src/node/db/API.ts` — add the programmatic `exports.anonymizeAuthor`
- Modify: `src/node/handler/APIHandler.ts` — register version 1.3.1

- [ ] **Step 1: Add the API.ts entry**

Open `src/node/db/API.ts`. Near the other author-surface exports
(`exports.createAuthor`, `exports.getAuthorName`) append:

```typescript
/**
 * anonymizeAuthor(authorID) — GDPR Art. 17 erasure. See doc/privacy.md.
 *
 * @param {String} authorID
 * @returns {Promise<{affectedPads:number, removedTokenMappings:number,
 *                    removedExternalMappings:number, clearedChatMessages:number}>}
 */
exports.anonymizeAuthor = async (authorID: string) => {
  if (!authorID || typeof authorID !== 'string') {
    throw new CustomError('authorID is required', 'apierror');
  }
  return await authorManager.anonymizeAuthor(authorID);
};
```

(`CustomError` and `authorManager` are already imported at the top of
`API.ts`.)

- [ ] **Step 2: Register a new API version**

In `src/node/handler/APIHandler.ts`, append a new version entry below
`version['1.3.0']`:

```typescript
version['1.3.1'] = {
  ...version['1.3.0'],
  anonymizeAuthor: ['authorID'],
};

// set the latest available API version here
exports.latestApiVersion = '1.3.1';
```

Replace the existing `exports.latestApiVersion = '1.3.0';` line with
the `1.3.1` string so the REST `/api/` endpoint advertises it.

- [ ] **Step 3: Type check + commit**

Run: `pnpm --filter ep_etherpad-lite run ts-check`

```bash
git add src/node/db/API.ts src/node/handler/APIHandler.ts
git commit -m "feat(gdpr): REST anonymizeAuthor on API version 1.3.1"
```

---

## Task 4: REST integration test

**Files:**
- Create: `src/tests/backend/specs/api/anonymizeAuthor.ts`

- [ ] **Step 1: Write the spec**

```typescript
'use strict';

import {strict as assert} from 'assert';

const common = require('../../common');

let agent: any;
let apiVersion = '1.3.1';
const endPoint = (point: string) => `/api/${apiVersion}/${point}`;

const callApi = async (point: string, query: Record<string, string> = {}) => {
  const qs = new URLSearchParams(query).toString();
  const path = qs ? `${endPoint(point)}?${qs}` : endPoint(point);
  return await agent.get(path)
      .set('authorization', await common.generateJWTToken())
      .expect(200)
      .expect('Content-Type', /json/);
};

describe(__filename, function () {
  before(async function () {
    this.timeout(60000);
    agent = await common.init();
    const res = await agent.get('/api/').expect(200);
    apiVersion = res.body.currentVersion;
  });

  it('anonymizeAuthor zeroes the author and returns counters', async function () {
    const create = await callApi('createAuthor', {name: 'Alice'});
    assert.equal(create.body.code, 0);
    const authorID = create.body.data.authorID;

    const res = await callApi('anonymizeAuthor', {authorID});
    assert.equal(res.body.code, 0, JSON.stringify(res.body));
    assert.ok(res.body.data.affectedPads >= 0);

    const name = await callApi('getAuthorName', {authorID});
    assert.equal(name.body.data.authorName, null);
  });

  it('anonymizeAuthor with missing authorID returns an error', async function () {
    const res = await agent.get(`${endPoint('anonymizeAuthor')}?authorID=`)
        .set('authorization', await common.generateJWTToken())
        .expect(200)
        .expect('Content-Type', /json/);
    assert.equal(res.body.code, 1);
    assert.match(res.body.message, /authorID is required/);
  });
});
```

- [ ] **Step 2: Run**

Run: `cd src && NODE_ENV=production pnpm exec mocha --require tsx/cjs tests/backend/specs/api/anonymizeAuthor.ts --timeout 60000`
Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tests/backend/specs/api/anonymizeAuthor.ts
git commit -m "test(gdpr): REST anonymizeAuthor end-to-end"
```

---

## Task 5: Docs

**Files:**
- Modify: `doc/privacy.md` — add a "Right to erasure" section

- [ ] **Step 1: Check whether the file exists on this branch**

`doc/privacy.md` is created in PR2 (#7547) and PR4 (#7549). If the
branch doesn't have it yet, create a minimal stub first:

```bash
ls doc/privacy.md || cat > doc/privacy.md <<'EOF'
# Privacy

See [cookies.md](cookies.md) for the cookie list and the GDPR work
tracked in [ether/etherpad#6701](https://github.com/ether/etherpad/issues/6701).
EOF
```

- [ ] **Step 2: Append the erasure section**

Append:

```markdown
## Right to erasure (GDPR Art. 17)

Etherpad anonymises an author rather than deleting their changesets
(deletion would corrupt every pad they contributed to). Operators
trigger erasure via the admin REST API:

```bash
curl -X POST \
  -H "Authorization: Bearer <admin JWT / apikey>" \
  "https://<instance>/api/1.3.1/anonymizeAuthor?authorID=a.XXXXXXXXXXXXXX"
```

What the call does:

- Zeros `name` and `colorId` on the `globalAuthor:<authorID>` record
  (kept as an opaque stub so changeset references still resolve to
  "an author" with no details).
- Deletes every `token2author:<token>` and `mapper2author:<mapper>`
  binding that pointed at this author. Once removed, a new session
  with the same token starts a fresh anonymous identity.
- Nulls `authorId` on chat messages the author posted; message text
  and timestamps are unchanged.

What it does not do:

- Delete pad content, revisions, or the attribute pool. If a pad
  itself should also be erased, use the pad-deletion token flow
  (PR1, `deletePad`).
- Touch other authors' edits.

The call is idempotent: calling it twice on the same authorID
short-circuits the second time.
```

- [ ] **Step 3: Commit**

```bash
git add doc/privacy.md
git commit -m "docs(gdpr): right-to-erasure section + anonymizeAuthor example"
```

---

## Task 6: Verify + push + open PR

- [ ] **Step 1: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 2: Full backend test sweep**

```bash
cd src && NODE_ENV=production pnpm exec mocha --require tsx/cjs \
  tests/backend/specs/anonymizeAuthor.ts \
  tests/backend/specs/api/anonymizeAuthor.ts \
  tests/backend/specs/api/api.ts --timeout 60000
```

Expected: all pass.

- [ ] **Step 3: Push + open PR**

```bash
git push origin feat-gdpr-author-erasure
gh pr create --repo ether/etherpad --base develop --head feat-gdpr-author-erasure \
  --title "feat(gdpr): author erasure (PR5 of #6701)" --body "$(cat <<'EOF'
## Summary
- New `authorManager.anonymizeAuthor(authorID)` zeroes the display identity on `globalAuthor:<id>`, deletes every `token2author:*` and `mapper2author:*` binding that points at the author, and nulls `authorId` on chat messages they posted. Pad content, revisions, and attribute pool are intact.
- New REST endpoint `POST /api/1.3.1/anonymizeAuthor?authorID=…` — admin-auth via the existing apikey/JWT pipeline.
- Idempotent. Zero counters on second call.
- `doc/privacy.md` explains what the call does and does not do.

Final PR of the #6701 GDPR work. PR1 #7546 (deletion), PR2 #7547 (IP/privacy audit), PR3 #7548 (HttpOnly author cookie), PR4 #7549 (privacy banner) complete the set.

Design: `docs/superpowers/specs/2026-04-19-gdpr-pr5-author-erasure-design.md`
Plan: `docs/superpowers/plans/2026-04-19-gdpr-pr5-author-erasure.md`

## Test plan
- [x] ts-check
- [x] AuthorManager unit — identity zeroing, mappings removal, idempotence, unknown authorID
- [x] REST — successful erasure + missing-authorID error path
EOF
)"
```

- [ ] **Step 4: Monitor CI**

Run: `gh pr checks <PR-number> --repo ether/etherpad`

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| `globalAuthor:<id>` zeroing + `erased: true` | 1 |
| `token2author:*` / `mapper2author:*` deletion | 1 |
| Chat `authorId` null-out | 1 |
| Idempotent second call | 1, 2 |
| REST endpoint + OpenAPI pickup via version map | 3 |
| Unit tests | 2 |
| REST integration tests | 4 |
| Docs | 5 |

**Placeholders:** none.

**Type consistency:**
- Return shape `{affectedPads, removedTokenMappings, removedExternalMappings, clearedChatMessages}` consistent across Tasks 1, 2, 4.
- `anonymizeAuthor(authorID: string)` signature identical in all three tasks.
- API version string `'1.3.1'` used only in Task 3 and referenced in Task 4 / Task 6 docs.
