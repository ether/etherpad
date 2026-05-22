# /admin/settings — emit resolved runtime values alongside raw file

**Issue:** [ether/etherpad#7803](https://github.com/ether/etherpad/issues/7803)
**Date:** 2026-05-18

## Problem

`/admin/settings` reads `settings.json` off disk and emits its bytes
verbatim. The admin SPA then parses those bytes against its enum
dropdowns. Anywhere `${ENV_VAR:default}` appears, the SPA can't resolve
the variable and falls back to the template default — so operators see
values that don't reflect what Etherpad is actually running with.

Concrete example: `DB_TYPE=sqlite` in the container env, settings file
contains `"dbType": "${DB_TYPE:dirty}"`. Admin UI shows the DB Type
dropdown selected on `dirty`. Etherpad is genuinely on SQLite. The
admin UI is lying.

This is the only built-in way operators have to verify runtime config,
so a fix is overdue.

## Goals

1. The admin UI accurately shows what `settings.*` values Etherpad is
   actually using right now, including env-var-substituted values.
2. The raw textarea and `saveSettings` round-trip preserve the original
   `${VAR:default}` literals so an admin can still edit the template
   without baking env vars into the file.
3. Secrets that would otherwise leak (passwords, OIDC client secrets,
   session-signing material) are redacted from the resolved payload.

## Non-goals

- Rewriting the save path so admins can edit through the form view
  without touching env-var bindings. That's a larger UX rework — see
  Future Work.
- Changing `settings.json.template` or `settings.json.docker` on disk.
- Touching ep_kaput.

## Design

### Architecture

Extend the existing `'load'` socket handler in
`src/node/hooks/express/adminsettings.ts` to emit one additional
field next to the existing `results` blob:

```ts
socket.emit('settings', {
  results: rawFileString,           // unchanged — for textarea + saveSettings
  resolved: redactedRuntimeObject,  // new — parsed object, env vars resolved, secrets redacted
  flags,                            // unchanged
});
```

`resolved` is the in-memory `settings` module (which already had
`lookupEnvironmentVariables` applied to it at boot) passed through a
recursive redactor. Old clients that ignore `resolved` continue to
work unchanged. The `saveSettings` handler is not touched, so the
file's `${VAR:default}` literals survive save round-trips.

### Server: redactor

New module `src/node/utils/AdminSettingsRedact.ts` exporting:

```ts
export function redactSettings(settings: unknown): unknown
```

A pure function that takes the in-memory settings object, deep-clones
it (Node's built-in `structuredClone`, available since Node 17),
walks the clone, and replaces values at known sensitive JSON paths
with the sentinel string `"[REDACTED]"`. The original object is not
mutated. Functions on the live `settings` module — `coerceValue`,
`reloadSettings`, etc. — are dropped during the clone walk by
filtering them out before recursion (structured clone rejects
functions); the resolved payload contains only data.

Allow-list (paths use `*` for any object key and `[*]` for any array
index):

| Path | Reason |
|---|---|
| `users.*.password` | Plaintext basic-auth password |
| `users.*.passwordHash` | Bcrypt hash — credential material |
| `users.*.hash` | Older spelling used by some configs |
| `dbSettings.password` | DB password (mysql/postgres/redis) |
| `dbSettings.user` | Credential half — redact for symmetry |
| `sso.clients[*].client_secret` | OIDC client secret |
| `sso.clients[*].secret` | ep_openid_connect older spelling |
| `sso.issuer` | Only if URL contains `user:pass@` userinfo |
| `loadTest.*.password` | ep_load_test creds |
| `sessionKey` | Used to sign session cookies |

Behaviour:
- Redact to the literal string `"[REDACTED]"` regardless of original
  type, so the SPA only ever has to check one sentinel.
- A redacted leaf is redacted only at the leaf — siblings stay
  visible (e.g. `sso.clients[0].client_id` is shown,
  `sso.clients[0].client_secret` is redacted).
- If the underlying value was `null` (env var unset, no default),
  still emit `"[REDACTED]"` to avoid leaking "this secret is unset"
  via a visible `null`.
- `dbSettings.filename` is NOT redacted — operators need to verify
  their volume mount.

### Server: emit site

In `adminsettings.ts`, in `socket.on('load')`:

```ts
import {redactSettings} from '../../utils/AdminSettingsRedact';
// ...
const resolved = redactSettings(settings);
socket.emit('settings', {results: rawFileString, resolved, flags});
```

If `showSettingsInAdminPage === false`, omit `resolved` too (don't
emit a redacted runtime when the file blob is gated).

### Client: store

`admin/src/store/store.ts`:
- Add `resolved: unknown | null` to the store, defaulting to `null`.
- In the `'settings'` socket listener, store `payload.resolved ?? null`.
- Old servers that don't send `resolved` leave it `null` and the UI
  degrades to current behaviour.

`admin/src/utils/resolveByPath.ts` (new file — single-purpose helper):
- Export `resolveByPath(obj: unknown, path: JSONPath): unknown` —
  walks a plain JS object by a `jsonc-parser` JSONPath
  (`(string | number)[]`), returns `undefined` on miss. Pure,
  unit-tested.

`admin/src/store/store.ts`:
- Add a `useResolvedAt(path: JSONPath)` selector hook that returns
  `resolveByPath(state.resolved, path)`.

### Client: env pill widget

`admin/src/components/settings/widgets/EnvPill.tsx`:
- New optional prop `resolvedValue?: unknown`.
- When defined and not `'[REDACTED]'`: render a read-only chip after
  the editable default input, e.g. `→ sqlite`.
- When `'[REDACTED]'`: render `→ ••••••` with an i18n tooltip
  explaining the value is redacted.
- When `undefined` (old server or missing path): no chip; render
  exactly as today.

New i18n key `admin_settings.env_pill.runtime_label` and
`admin_settings.env_pill.redacted_tooltip`. No hardcoded English.

### Client: jsonc tree

`admin/src/components/settings/JsoncNode.tsx`:
- Where `matchEnvPlaceholder(raw)` is currently called (line ~42),
  also call `useResolvedAt(path)` and pass the result as
  `resolvedValue` to `<EnvPill>`.

### Client: form view

`admin/src/components/settings/FormView.tsx`:
- FormView already has access to the parsed JSONC tree through
  `rawText = useStore(s => s.settings)` plus jsonc-parser. For each
  control, after detecting that the raw value at its path is an env
  placeholder (`matchEnvPlaceholder` on the raw slice), the
  *selected* dropdown option / displayed input value is derived from
  `useResolvedAt(path)` rather than from the literal placeholder
  string. Plain (non-placeholder) values keep using the raw JSONC
  value as today.
- The env pill above the control still shows and is still editable
  (the editable input mutates the `default` portion of the
  placeholder in the raw JSONC, exactly as today).
- This is the fix for the original "dropdown shows `dirty` when DB is
  sqlite" complaint.

## Data flow

```
boot
  └─ Settings.ts:reloadSettings()
       └─ lookupEnvironmentVariables(parsedSettings)  -- ${VAR:default} → real value
            └─ writes into the exported `settings` module

admin loads /admin/settings
  └─ socket 'load'
       ├─ fsp.readFile(settings.settingsFilename)   -- raw, env vars unresolved
       └─ redactSettings(settings)                  -- live module, env vars resolved, secrets redacted
            socket.emit('settings', {results: raw, resolved, flags})

admin SPA
  ├─ raw textarea ← results                         -- preserves ${VAR:default}
  ├─ env pill chip ← resolveByPath(resolved, path)  -- shows "→ sqlite"
  └─ form view dropdown selection ← resolveByPath(resolved, path)

admin clicks Save
  └─ saveSettings emits the raw textarea blob (unchanged behaviour)
       └─ server writes verbatim to settings.json — template intact
```

## Error handling

- `redactSettings` is a pure function over a structured clone; no I/O,
  no rejection path. If it throws on a malformed live `settings`
  module (shouldn't happen — that module is the source of truth at
  runtime) we let the error propagate; the `socket.on('load')`
  handler already has no try/catch around the emit and any throw will
  surface in logs.
- On the client, `resolveByPath` returns `undefined` for missing
  paths. Consumers treat `undefined` as "no resolved value
  available" and fall back to current behaviour.
- Old client + new server: client ignores `resolved` — degrades to
  today's misleading UI, no regression.
- New client + old server: `resolved` is `null` — `useResolvedAt`
  returns `undefined` everywhere, env pill skips the chip, dropdowns
  fall back to current behaviour.

## Testing

Per the `feedback_always_run_backend_tests` and
`feedback_test_localized_strings` memories.

**Backend vitest** (`src/tests/backend/specs/`):
- `AdminSettingsRedact.spec.ts` — fixture per allow-list path, plus
  a no-op control case, plus a nested-secret-inside-an-array case.
- `adminsettings.spec.ts` — mock socket, set `process.env.DB_TYPE=sqlite`,
  call `reloadSettings()`, emit `load`, assert `resolved.dbType === 'sqlite'`
  and `resolved.dbSettings.password === '[REDACTED]'`.

**Frontend vitest** (`admin/src/`):
- `utils/resolveByPath.spec.ts` — nested objects, arrays, missing keys.
- `widgets/EnvPill.spec.tsx` — renders chip when value set, renders
  redacted chip when sentinel, omits chip when undefined.

**Playwright e2e** (`src/tests/frontend/specs/` or `src/tests/admin/`):
- Boot Etherpad with `DB_TYPE=sqlite` env on port 9003 (per
  `feedback_test_port_9003`).
- Open `/admin/settings`, switch to form view.
- Assert DB Type dropdown reflects `sqlite`, not `dirty`.
- Switch to raw view, assert env pill chip shows `→ sqlite`.

## Docs

Per `feedback_include_docs_updates`:
- Identify the existing admin-settings doc path during implementation
  (likely `doc/admin/admin-settings.md` or under `doc/api/`) — add a
  short section on the resolved-value chip and the `[REDACTED]`
  sentinel. If no such doc exists yet, no new doc is created in this
  PR (avoid the "don't create docs unless asked" rule); instead, a
  pointer in the PR description.
- Follow-up PR to `ether/home-assistant-addon-etherpad/etherpad/DOCS.md`
  to remove the "admin settings page is cosmetic" caveat once this
  ships; reference from the etherpad PR description.

## Future work

- Form-view save path that lets an admin edit a value without
  touching its env-var binding. Today FormView writes back to raw
  JSONC; the env-pill default input is the only way to edit an
  env-bound value, which is awkward for non-string values.
- An audit log of redacted-vs-visible keys so plugins can declare
  additional secret paths via a hook.

## Implementation footprint

- New file `src/node/utils/AdminSettingsRedact.ts` (~80 lines + JSDoc).
- `src/node/hooks/express/adminsettings.ts` — ~4 lines changed.
- New file `admin/src/utils/resolveByPath.ts` (~15 lines).
- `admin/src/store/store.ts` — ~10 lines changed (store field,
  selector hook).
- `admin/src/components/settings/widgets/EnvPill.tsx` — ~15 lines
  added (prop, chip render).
- `admin/src/components/settings/JsoncNode.tsx` — ~3 lines changed.
- `admin/src/components/settings/FormView.tsx` — modest changes per
  control type; estimate ~30 lines.
- New i18n keys in `src/locales/en.json` (English source).
- Tests: ~4 spec files, ~200 lines.
- Docs: ~30 lines.

Total: ~400 lines including tests and docs.
