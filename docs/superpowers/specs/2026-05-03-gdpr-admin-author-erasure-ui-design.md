# Admin UI for GDPR Art. 17 author erasure

Follow-up to PR5 of #6701 (`feat-gdpr-author-erasure`, merged via #7550).
PR5 shipped the `anonymizeAuthor` capability as a REST endpoint only.
This spec adds an in-product surface so an operator can find and erase
an author from `/admin` without crafting a `curl`.

## Problem

After PR5, erasing an author requires:

1. Knowing the opaque `authorID` (e.g. `a.XXXXXXXXXXXXXXXX`).
2. Holding admin credentials (apikey / JWT).
3. Running a `curl` against `/api/1.3.1/anonymizeAuthor` with the
   correct settings flag enabled.

For instances handling real GDPR Art. 17 requests this is too much
friction and too easy to mis-target (the only check before destruction
is "did you paste the right ID?"). Operators have asked for the same
"search → click → confirm" flow they already have for pads.

## Goals

1. Admins can locate an author by display name **or** by external
   mapper (SSO subject, token-binding key) — the two identifiers a
   GDPR request typically arrives carrying.
2. Before the irreversible erasure runs, the admin sees a server-side
   preview of what will be touched (mappings, chat messages, affected
   pads).
3. The page itself is discoverable even when the feature flag is off,
   so admins know the capability exists and where to enable it.
4. No new public API surface; the public REST endpoint is unchanged
   and its single feature flag (`gdprAuthorErasure.enabled`) keeps its
   existing meaning.

## Non-goals

- **Pad-context discovery** (drilling from a pad to its contributors).
  Possible follow-up; not in this spec.
- **Bulk erase / multi-select.** GDPR requests are per-subject.
- **Audit-log export of erasures.** Operators already have log4js +
  the existing `anonymizeAuthor` log line.
- **Undo / recovery.** Erasure is irreversible by design.
- **Refactoring `PadPage.tsx`** into a shared list-page component.
  After this lands there will be two real consumers; the abstraction
  comes then, not before.
- **Backfill migration for the new `lastSeen` field.** New-on-touch
  only; pre-existing records show `—` until they are touched again.

## UX

A new admin page at `/admin/authors`, sidebar entry between Pads and
Shout (icon: `Users` from lucide).

Layout mirrors `PadPage.tsx`:

- Search field — substring match on `name` OR `mapper`.
- Toggle "Show erased authors" (off by default).
- Sortable table:
  | Color | Name | Mapper | Last seen | Author ID | Actions |
  - Color renders as an inline `<span>` with `background-color`.
  - Author ID column shows the full ID (copyable).
  - Mapper column renders the first mapper string; if an author has
    more than one (multi-SSO accounts, rare), append `+N` and show
    the full list in a `title` tooltip.
  - Actions column has a single `Trash2` "Erase" button per row.
- Pagination — 12 rows per page (matches Pads).
- Cap warning — when the server reports `cappedAt`, render a banner
  "Showing first 1000 authors. Narrow your search to see more."

### Erasure flow (two-step)

Clicking "Erase" opens a Radix `Dialog.Root` with two phases held in
local state (`'preview' | 'committing' | 'closed'`):

1. **Preview** — open emits `anonymizeAuthorPreview`. While waiting
   the modal shows a spinner. On `results:anonymizeAuthorPreview`,
   counters render:
   > About to erase author **`<name>`** (`a.XXXX`).
   > Will clear: **N** token mappings, **M** mapper bindings, **K**
   > chat messages, across **P** pads.
   > **This cannot be undone.**

   Buttons: Cancel · Continue.

2. **Commit** — Continue emits `anonymizeAuthor`. On
   `results:anonymizeAuthor` the modal closes, a success toast
   renders, and the row is replaced in-place with a greyed
   "(erased)" stub.

If `results:anonymizeAuthor` carries `error`, the modal stays open
and surfaces the error inline (no destructive close-on-error).

### Disabled-flag UX

When `gdprAuthorErasure.enabled = false`:

- The page renders normally — table, search, sort and pagination
  all work (read-only browse is harmless).
- A persistent banner at the top reads:
  > Author erasure is disabled. Set `"gdprAuthorErasure": {"enabled":
  > true}` in `settings.json` to enable.
- Every Erase button is disabled with the same message as a
  `title` tooltip.
- The dry-run preview event remains usable from the admin socket
  (it is read-only and admin-authed) — but the UI does not invoke it
  while the live action is disabled, to avoid implying an action is
  about to happen.

## Backend

Three new admin-socket events on the existing `settings_admin` socket
(parallel to `deletePad` / `cleanupPadRevisions`). **Not REST.**
Rationale: matches the existing admin pattern, reuses the admin-auth
middleware, and keeps the public REST surface unchanged so
`gdprAuthorErasure.enabled` keeps its single meaning ("expose the
public REST endpoint").

| Event in | Payload | Event out | Result shape |
|---|---|---|---|
| `authorLoad` | `{offset, limit, pattern, sortBy, ascending, includeErased}` | `results:authorLoad` | `{total, cappedAt?, results: [{authorID, name, colorId, mapper, lastSeen, erased}]}` |
| `anonymizeAuthorPreview` | `{authorID}` | `results:anonymizeAuthorPreview` | `{authorID, name, removedTokenMappings, removedExternalMappings, clearedChatMessages, affectedPads}` |
| `anonymizeAuthor` | `{authorID}` | `results:anonymizeAuthor` | `{authorID, ...counters} \| {authorID, error: 'disabled' \| 'unknown' \| <message>}` |

### `authorManager.searchAuthors(query)`

New helper. Algorithm:

1. `keys = await db.findKeys('globalAuthor:*', null)`.
2. `mapperIndex = Map<authorID, mapper[]>` built once via
   `db.findKeys('mapper2author:*', null)` + a single batch read of
   the values. (`mapper2author:<mapper>` → `{authorID}`.)
3. For each `globalAuthor:<id>` record:
   - read the record;
   - skip if `erased` and `!includeErased`;
   - filter on `pattern` (substring match on `name` OR any mapper in
     `mapperIndex.get(authorID) ?? []`);
   - emit `{authorID, name, colorId, mapper: mapperIndex.get(...) ??
     [], lastSeen, erased}`.
4. Sort the in-memory list by `sortBy` (`name` | `lastSeen`),
   ascending or descending.
5. If pre-pagination length > 1000, slice to 1000 and set `cappedAt:
   1000`.
6. Apply `offset`/`limit` for pagination; return `{total, cappedAt?,
   results}` where `total` is the post-filter, post-cap count.

Performance is acceptable for the typical instance size and is bounded
by the cap. A proper indexed scan can replace this if anyone hits the
cap regularly — explicit follow-up, not now.

### `lastSeen` field

Added to `globalAuthor:<id>`. Set to `Date.now()` on the existing
write paths in `AuthorManager` that already touch the record
(`setAuthorName`, `setAuthorColorId`, `createAuthor*`) — i.e. when
an author actively does something the system records. Read paths are
not modified to avoid an extra write per page load. New-on-touch
only; no migration sweep. Surfaced as ISO-8601 in the search result
and rendered as `toLocaleString()` in the UI. Records without
`lastSeen` render as `—`.

### Dry-run plumbing

`authorManager.anonymizeAuthor(authorID, {dryRun: true})` returns the
same counter shape without writing. Implementation: walk the same
loops, count, return — no `db.set` / `db.remove`. Same admin-auth gate
on the socket layer. The `gdprAuthorErasure.enabled` flag does NOT
gate the dry-run path (read-only, admin-authed); it only gates the
live `anonymizeAuthor` socket event (matching the public REST
endpoint's behaviour).

### Settings flag delivery to client

The `settingsSocket` already streams an `init` payload to the admin
on connect. Add `gdprAuthorErasure: settings.gdprAuthorErasure` to it
and have `App.tsx` populate `gdprAuthorErasureEnabled` in the store
once on connect. The page renders the disabled banner when false.

## Frontend

### New files

- `admin/src/pages/AuthorPage.tsx` — page component, mirrors
  `PadPage.tsx` shape.
- `admin/src/utils/AuthorSearch.ts` — `AuthorSearchQuery`,
  `AuthorSearchResult`, `AuthorRow` types.
- `admin/src/components/ColorSwatch.tsx` — small `<span>` with inline
  `background-color`. Reusable.

### Edited files

- `admin/src/store/store.ts` — `authors`, `setAuthors`,
  `gdprAuthorErasureEnabled`.
- `admin/src/main.tsx` — register `<Route path="/authors"
  element={<AuthorPage/>}/>`.
- `admin/src/App.tsx` (or whichever file owns the sidebar) — new
  "Authors" link between Pads and Shout.
- `admin/src/localization/locales/en.json` — see i18n keys below.
- `src/node/hooks/express/admin.ts` — extend the `init` payload with
  `gdprAuthorErasure`.
- `src/node/hooks/express/settings_admin.ts` (or equivalent) — wire
  the three new socket events.

### i18n keys

All user-visible strings go through `Trans` / `t()` per the project's
i18n rule. New keys:

- `ep_admin_authors:title`
- `ep_admin_authors:search-placeholder`
- `ep_admin_authors:column.color`
- `ep_admin_authors:column.name`
- `ep_admin_authors:column.mapper`
- `ep_admin_authors:column.last-seen`
- `ep_admin_authors:column.author-id`
- `ep_admin_authors:column.actions`
- `ep_admin_authors:show-erased`
- `ep_admin_authors:erase`
- `ep_admin_authors:erased-stub`
- `ep_admin_authors:cap-warning`
- `ep_admin_authors:feature-disabled-banner`
- `ep_admin_authors:confirm-preview-title`
- `ep_admin_authors:confirm-preview-counters`
- `ep_admin_authors:confirm-irreversible`
- `ep_admin_authors:cancel`
- `ep_admin_authors:continue`
- `ep_admin_authors:erase-success-toast`
- `ep_admin_authors:erase-error-toast`

Other locales fall back to English until translated.

## Testing

Per the project rule, both backend and frontend suites ship with the
PR.

### Backend (`mocha --import=tsx`)

- **`src/tests/backend/specs/admin/authorSearch.ts`** — covers
  `authorManager.searchAuthors`:
  - empty store → `{total: 0, results: []}`
  - 3 authors, no filter → all 3, sorted by name asc
  - search by name substring matches
  - search by mapper substring matches (joins `mapper2author`)
  - `includeErased: false` (default) hides erased; `true` includes
  - sort by `lastSeen` asc / desc
  - cap-at-1000: insert 1100, assert `results.length === 1000` and
    `cappedAt === 1000`.
- **`src/tests/backend/specs/anonymizeAuthor.ts`** (extend existing):
  - dry-run returns the same counter shape as the live path without
    mutating `globalAuthor:<id>`
  - dry-run on an unknown authorID returns zeros without throwing.
- **`src/tests/backend/specs/admin/anonymizeAuthorSocket.ts`** —
  admin-socket integration:
  - opens `settings_admin` with admin creds;
  - `authorLoad` round-trip;
  - `anonymizeAuthorPreview` round-trip; asserts `erased` is NOT
    flipped on the record;
  - live `anonymizeAuthor` round-trip when flag enabled;
  - live `anonymizeAuthor` returns `{error: 'disabled'}` when flag
    off;
  - dry-run preview still works when flag off.

### Frontend (Playwright, `src/tests/frontend-new/specs/`)

- **`admin_authors_page.spec.ts`**:
  - navigates to `/admin/authors` via the existing admin auth
    fixture;
  - seeds two authors via the existing API helpers;
  - asserts the localized header string (`t('ep_admin_authors:title')`)
    renders — not just element presence (per project rule);
  - search by name filters the table to one row;
  - clicking Erase opens the modal; preview counters render;
    Continue commits; row shows the localized "(erased)" stub;
    success toast text matches the localized string;
  - with the feature flag toggled off via the test settings hook,
    the localized banner renders and the Erase button is disabled.

## Backwards compatibility

- The admin socket gains three new events; absent admin builds
  ignore them.
- The public REST endpoint and its flag are unchanged.
- Adding `lastSeen` to `globalAuthor` is additive — older record
  readers ignore unknown fields.
- No DB migration required.
