# PR5 — GDPR Author Erasure (Right to be Forgotten)

Last of five GDPR PRs (ether/etherpad#6701). Implements anonymisation
of an author's identity — display name, colour, and the token/mapper
bindings that link a real-world session to an `authorID` — while
leaving pad content intact. This is the GDPR-preferred shape for Art.
17 (erasure) because deleting the author's edits would corrupt every
pad they touched.

## Audit summary

What links an authorID back to a real person today:

| DB key | Content | Personal? |
| --- | --- | --- |
| `globalAuthor:<authorID>` | `{name, colorId, timestamp}` plus whatever plugins stamp | **yes** (display name) |
| `token2author:<token>` | `authorID` | **yes** (token is the browser-side secret) |
| `mapper2author:<mapper>` | `authorID` | **yes** (mapper is SSO / API caller identity) |
| `pad:<id>:chat:<n>` → `ChatMessage` | stored with `authorId` | authorID ref only, no name |
| `pad:<id>:revs:<n>` / changesets + attrib pool | embedded `author` attrib keyed by `authorID` | authorID ref only, no name |

Anonymising the three author-keyed records severs the link between the
authorID and the person. The changeset/chat references that remain are
opaque and unlinkable without the first three.

## Goals

- Server-side `anonymizeAuthor(authorID)` that:
  - zeroes `name`, `colorId` in `globalAuthor:<authorID>` (keeps the
    key so changeset references still resolve to "an author" with no
    details)
  - deletes every `token2author:<token>` entry pointing at the author
  - deletes every `mapper2author:<mapper>` entry pointing at the author
  - iterates the author's pads and rewrites each pad's in-memory chat
    messages so `authorId` becomes `null`, then persists
  - leaves pad content, revision history, and attribute pools alone
- Admin REST endpoint `POST /api/<ver>/anonymizeAuthor` that wraps the
  call; auth uses the existing apikey / JWT admin path.
- Idempotent: calling twice on the same authorID is a no-op.

## Non-goals

- Deleting the author's pads. Erasing is shaped as anonymisation, not
  deletion — operators who want a pad gone can use PR1 (#7546).
- Rewriting the attribute pool in every pad to drop the author entirely.
  Grep of `src/node/utils/padDiff` confirms existing consumers (line
  colours, authorship-history sidebar) already handle missing
  `globalAuthor:<id>.name` by displaying a blank author — the UI
  degrades to "an anonymous author" without further changes.
- Rolling up historical chat into one big aggregate. We touch each
  message individually, keeping its timestamp and text intact.
- Adding a "undo erasure" path. GDPR erasure is one-way.

## Design

### AuthorManager surface

```typescript
// src/node/db/AuthorManager.ts additions
exports.anonymizeAuthor = async (authorID: string): Promise<{
  affectedPads: number,
  removedTokenMappings: number,
  removedExternalMappings: number,
  clearedChatMessages: number,
}> => { /* ... */ };
```

Pseudocode:

```typescript
const existing = await db.get(`globalAuthor:${authorID}`);
if (existing == null) return {affectedPads: 0, removedTokenMappings: 0, /* ... */};

// 1. Redact identity on the globalAuthor record but keep the record
//    itself so the authorID is still a valid key for historical data.
await db.set(`globalAuthor:${authorID}`, {
  colorId: 0,
  name: null,
  timestamp: Date.now(),
  padIDs: existing.padIDs,     // retain pad membership — it is not PII on its own
  erased: true,
  erasedAt: new Date().toISOString(),
});

// 2. Drop token/mapper bindings that point at this author.
let removedTokenMappings = 0;
let removedExternalMappings = 0;
for (const [key, value] of await db.findKeys('token2author:*', null)
    .then((keys) => Promise.all(keys.map(async (k) => [k, await db.get(k)] as const)))) {
  if (value === authorID) { await db.remove(key); removedTokenMappings++; }
}
for (const [key, value] of await db.findKeys('mapper2author:*', null)
    .then((keys) => Promise.all(keys.map(async (k) => [k, await db.get(k)] as const)))) {
  if (value === authorID) { await db.remove(key); removedExternalMappings++; }
}

// 3. Walk the author's pads and null-out chat messages they authored.
const padIDs = existing.padIDs || {};
let clearedChatMessages = 0;
for (const padID of Object.keys(padIDs)) {
  if (!await padManager.doesPadExist(padID)) continue;
  const pad = await padManager.getPad(padID);
  for (let i = 0; i < pad.chatHead + 1; i++) {
    const key = `pad:${padID}:chat:${i}`;
    const chat = await db.get(key);
    if (chat && chat.authorId === authorID) {
      chat.authorId = null;
      await db.set(key, chat);
      clearedChatMessages++;
    }
  }
}

return {
  affectedPads: Object.keys(padIDs).length,
  removedTokenMappings,
  removedExternalMappings,
  clearedChatMessages,
};
```

Notes:
- `db.findKeys` exists in etherpad's DB abstraction (used by
  `Pad.listAuthors` etc.). If unavailable for a given ueberdb driver,
  fall back to scanning via the pad lists we already have — the
  common databases (`dirty`, `sqlite`, `postgres`, `redis`) all
  support it.
- We never edit revision changesets or the attribute pool. A previously
  anonymised author remains present in the pool under their opaque
  `authorID`; without the `globalAuthor.name` the UI shows a blank
  author strip, which is the desired degradation.

### REST API

Extend the existing API versioning map in
`src/node/handler/APIHandler.ts`:

```typescript
version['1.3.1'] = {
  ...version['1.3.0'],
  anonymizeAuthor: ['authorID'],
};
exports.latestApiVersion = '1.3.1';
```

In `src/node/db/API.ts`:

```typescript
exports.anonymizeAuthor = async (authorID: string) => {
  if (!authorID) throw new CustomError('authorID is required', 'apierror');
  return await authorManager.anonymizeAuthor(authorID);
};
```

Auth: the existing `APIHandler.handle` already enforces apikey or JWT
admin auth before dispatching to `api[functionName]`, so no extra
gating needed.

### OpenAPI

`RestAPI.ts` builds the OpenAPI document from `APIHandler.version`.
Because `anonymizeAuthor` is a new entry in the version map, the
generated OpenAPI definition picks it up automatically — no manual
edits required.

### Docs

- Add a "Right to erasure" section to `doc/privacy.md` describing:
  - what happens to the author record,
  - what is kept (pad content, revision history, opaque authorID),
  - how operators trigger it (`POST /api/1.3.1/anonymizeAuthor?authorID=...`).
- Add an admin-facing one-liner to `doc/api/http_api.md` referencing
  the new endpoint if the file exists.

## Testing

### Unit

`src/tests/backend/specs/anonymizeAuthor.ts`:

1. Seed a fresh author via `authorManager.createAuthor('Alice')`.
   Confirm `globalAuthor.name === 'Alice'`, a token mapping exists,
   a mapper mapping exists (use `setAuthorName` + `getAuthorId` to
   create them).
2. Call `anonymizeAuthor(authorID)`.
3. Assert:
   - `globalAuthor:<authorID>` still exists with `{name: null, colorId: 0, erased: true}`.
   - `token2author:<token>` deleted.
   - `mapper2author:<mapper>` deleted.
   - Second call is a no-op and returns zero counters.

### REST integration

`src/tests/backend/specs/api/anonymizeAuthor.ts`:

1. `createAuthor` via API, get `authorID`.
2. `POST anonymizeAuthor?authorID=<id>` with JWT admin token → expect
   `code: 0, data: {affectedPads, removedTokenMappings, ...}`.
3. `getAuthorName(authorID)` → returns `null`.
4. Call `anonymizeAuthor` with missing `authorID` → returns
   `code: 1, message: 'authorID is required'`.

### Chat regression

Light touch: create a pad, chat as the author, call anonymizeAuthor,
load `getChatHistory`, confirm the message text is unchanged and
`authorId` is `null`.

## Risk and migration

- `padIDs` in the original `globalAuthor` record is kept intact —
  needed to find which pads need chat-scrub, and not personally
  identifying on its own (pad IDs are user-chosen strings; they can
  point to named URLs but that's an operator-level concern).
- Idempotent: erased records carry `erased: true`, so the helper
  short-circuits on subsequent calls without re-walking pads.
- If an author was active on thousands of pads, the chat loop can be
  slow. Document the worst-case cost; real-world GDPR requests are
  single-digit frequency, so a one-time scan is acceptable.
- `ueberdb` `findKeys` has per-driver caveats. The unit test uses the
  `dirty` driver which supports the glob. The REST test runs under
  the same driver via `common.init()`.
