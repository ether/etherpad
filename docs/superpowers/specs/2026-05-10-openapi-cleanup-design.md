# OpenAPI cleanup for downstream tooling — Design

**Date:** 2026-05-10
**Owner:** John McLear
**Scope:** `src/node/hooks/express/openapi.ts` + type tweak + tests
**Driven by:** integrating Etherpad with [printingpress.dev](https://printingpress.dev). Generating a Go CLI / Claude Code skill from `/api/openapi.json` revealed structural problems in the served spec that hurt every downstream consumer (printing-press, Postman, Swagger UI, openapi-generator, etc.). This PR fixes Etherpad's spec; generating and publishing a CLI is a follow-up that depends on this landing.

## Problems in the current spec

A live capture of `/api/openapi.json` (Etherpad 1.3.0, 48 paths) showed:

1. **Top-level `tags` array is empty/null.** Per-operation `tags: ["pad"]`, `["group"]`, etc. are populated for ops in the `resources` map, but consumers that group by tag (printing-press, Swagger UI sidebar, openapi-generator's resource modules) need the top-level array to discover and order them.

2. **Every operation duplicated as GET and POST.** Lines 562–573 of `openapi.ts` deliberately emit `paths[path] = { get: {...UsingGET}, post: {...UsingPOST} }`. The original comment ("It may be confusing that every operation can be called with both GET and POST") acknowledges this. A 48-path API generates a 96-operation CLI with `check-token using-get` + `check-token using-post`, etc.

3. **14 operations missing from the `resources` map.** As new API versions were added (1.2.8 → 1.3.1), `APIHandler.ts` got new functions but the `resources` map in `openapi.ts` was never updated. Affected ops have no `tags`, no `summary`, no `description`:
   - `getAttributePool`, `getRevisionChangeset`, `copyPad`, `movePad`, `getPadID`, `getSavedRevisionsCount`, `listSavedRevisions`, `saveRevision`, `restoreRevision`, `appendText`, `getStats`, `copyPadWithoutHistory`, `compactPad`, `anonymizeAuthor`

4. **Empty summaries on tracked ops.** `listSessionsOfGroup`, `listAllGroups`, `createDiffHTML` had `summary: ''`. `createPad` had no summary at all.

## Non-goals

- **Deprecating GET routes at runtime.** Existing third-party clients use `GET /api/1.x.x/foo?apikey=...`. Removing GET would be a breaking change for them — out of scope. This PR only changes what the spec *advertises*.
- **Fixing printing-press's operationId derivation bug** (`get-html_get-htmlusing-get`). Generator-side issue.
- **Admin API spec** (`/admin/openapi.json`). Different surface, separate cleanup if needed later.

## Design

### Per-op tag overrides

The simplest fix for Problem 3-and-friends is to allow per-operation `tags` overrides in the `resources` map. Existing chat ops (`getChatHistory`, `getChatHead`, `appendChatMessage`) and `checkToken` are nested under `pad` for routing reasons; tagging them as `chat` / `server` without restructuring the map preserves all REST URLs.

The operations builder destructures `tags` from each spec entry and falls back to `[resource]` when absent:

```ts
const {operationId, responseSchema, tags: customTags, ...operation} = spec as any;
// ...
operations[operationId] = {
  operationId,
  ...operation,
  responses,
  tags: customTags || [resource],
  _restPath: `/${resource}/${action}`,
};
```

The `SwaggerUIResource` type gains an optional `tags?: string[]` field.

### Top-level tags array

Added inside `generateDefinitionForVersion`'s returned `definition` object:

```ts
tags: [
  {name: 'pad',     description: 'Pad lifecycle, content, revisions, attributes'},
  {name: 'author',  description: 'Authors and authorship'},
  {name: 'session', description: 'Group sessions'},
  {name: 'group',   description: 'Groups (multi-tenant pads)'},
  {name: 'chat',    description: 'In-pad chat history'},
  {name: 'server',  description: 'Server-level operations (stats, token check)'},
],
```

### Backfill missing entries

14 operations added to `resources` with proper summaries. Most go under `pad`; `anonymizeAuthor` under `author`; `getStats` and (re-tagged) `checkToken` under a new `server` resource group.

| Tag    | Operation                  | Summary                                                       |
|--------|----------------------------|---------------------------------------------------------------|
| pad    | `getAttributePool`         | returns the attribute pool of a pad                           |
| pad    | `getRevisionChangeset`     | returns the changeset at a given revision of a pad            |
| pad    | `copyPad`                  | copies a pad with full history and chat                       |
| pad    | `movePad`                  | moves a pad — copy then delete the original                   |
| pad    | `getPadID`                 | returns the read-write pad ID for a given read-only pad ID    |
| pad    | `getSavedRevisionsCount`   | returns the number of saved revisions of a pad                |
| pad    | `listSavedRevisions`       | returns the list of saved revisions of a pad                  |
| pad    | `saveRevision`             | saves a revision of a pad                                     |
| pad    | `restoreRevision`          | restores a pad to a specific revision                         |
| pad    | `appendText`               | appends text to a pad                                         |
| pad    | `copyPadWithoutHistory`    | copies a pad without history or chat                          |
| pad    | `compactPad`               | compacts a pad's revision history, keeping recent ones        |
| author | `anonymizeAuthor`          | anonymizes an author across all their edits                   |
| server | `getStats`                 | returns server-wide statistics                                |

`checkToken` moves from pad → server (was previously the only "system-level" op nested under pad).

### Runtime vs published spec split

`generateDefinitionForVersion` gains a `{public}` flag:

```ts
const generateDefinitionForVersion = (
    version: string,
    style: string = APIPathStyle.FLAT,
    {public: isPublic = false}: {public?: boolean} = {},
) => { ... }
```

When `isPublic`, paths emit only `post:`. Otherwise both `get:` and `post:` (current behavior).

- The `definition` passed to `new OpenAPIBackend({...})` stays as-is (no flag) → both verbs routed at runtime → backward compat preserved.
- The handlers serving `/api/openapi.json`, `/rest/openapi.json`, `/api/{version}/openapi.json` call with `{public: true}` → clients see clean POST-only API.

operationIds in the public spec are unchanged (`${name}UsingPOST`), so any tooling already generated from the previous spec still finds its operations — strict subset, not rename.

## Test plan

Two new describe blocks in `src/tests/backend/specs/api/api.ts` (existing home for `/api/openapi.json` tests):

1. **public OpenAPI spec shape** — fetches `/api/openapi.json` once, asserts:
   - Top-level `tags` array contains `{pad, author, session, group, chat, server}`
   - Every operation has `tags: [...]` with ≥1 non-empty entry
   - Every operation has a non-empty `summary` (≥3 chars)
   - Every path advertises only `post:`

2. **runtime backward compatibility** — drives the live API:
   - `GET /api/{v}/checkToken?apikey=...` returns code 0
   - `POST /api/{v}/checkToken` returns code 0

These assert both halves of the design: the published spec is clean, and the runtime hasn't lost backward-compat routing.

## Blast radius

- **Runtime callers** (third-party scripts, ep_ai_mcp's HTTP fallback paths if any, dashboards, CI hooks): zero impact. Both GET and POST routes still resolve.
- **Tooling regenerators** (Postman collections, Swagger UI, openapi-generator clients): strict improvement. Smaller, better-named, properly-grouped surface. operationIds stable.
- **REST-style URLs** (`/rest/...`): unchanged for every existing op. No restructuring of `resources` was needed because per-op tag overrides do the work. New backfilled ops (`getAttributePool` etc.) gain a `/rest/X/pad/getAttributePool` path; their previous fallback `/rest/X/getAttributePool` is no longer the canonical REST route, but FLAT (`/api/...`) is unchanged.

## Out-of-band note

The spec already serves at three URLs (`/api/openapi.json`, `/rest/openapi.json`, `/api/{version}/openapi.json`); the cleanup applies to all three because the same builder backs them.

A separate admin spec exists at `/admin/openapi.json` (added in #7693/#7705) — out of scope here, worth a similar audit later.

## Follow-up phases (not part of this PR)

- **Phase B:** point printing-press at the cleaned spec, generate `etherpad` Go CLI + Claude Code skill, push to a new `ether/etherpad-cli` repo, submit to printingpress.dev community library.
- **Phase C:** submit `ep_ai_mcp` as the canonical MCP entry in printingpress.dev's library — generated MCP from OpenAPI would be strictly worse (no changeset/authorship reach-through).
