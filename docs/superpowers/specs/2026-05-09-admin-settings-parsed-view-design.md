# Admin /settings parsed view — design

Date: 2026-05-09
Status: draft, awaiting review
Related: closes #7603, supersedes parts of #7666 / #7709

## Problem

`/admin/settings` renders `settings.json` as a single textarea. Admins
asked (#7603) for a parsed view that surfaces each key with the JSONC
comment that documents it, so the file stops looking like an opaque blob.

The current PR (#7709) only restyles the textarea and adds Validate /
Prettify / Restart buttons. The actual "parsed per-key with inline
comments" feature is still missing.

## Goals

- Render `settings.json` as a tree of typed widgets, one per key.
- Show each key's leading `/* */` or `//` comment as inline help text.
- Round-trip back to `settings.json` preserving comments, key order,
  whitespace, and `${ENV:default}` placeholders byte-identically for
  keys the admin did not edit.
- Keep a raw textarea fallback for power users and structural edits.

## Non-goals (deferred)

- Adding or removing keys from the form view.
- Editing `${ENV:default}` placeholders inline. They render as
  read-only pills; structural changes go through raw mode.
- Curated, schema-driven help text. Comments in `settings.json` are
  the help text; we don't ship a parallel schema.
- Search / filter / collapse-all controls.

## Constraints

- `settings.json` is JSONC: `/* */` and `//` comments, trailing commas
  tolerated by the loader.
- Values can contain `${VAR:default}` placeholders that the server
  resolves at boot. The form must not rewrite or normalise these.
- Server already ships the raw file text down `settingsSocket` and
  accepts a full-text `saveSettings` event back. We don't change the
  server contract.

## Architecture

All parsing and editing run in the browser. The server-side path is
unchanged.

```
load     server reads settings.json --raw text--> settingsSocket --> store.settings
edit     widget --modify(text, path, value)--> new text --> store.settings
save     store.settings --emit('saveSettings', text)--> server writes file
```

The store keeps a single source of truth: the file text. The AST is
re-parsed from the text on each render of the form view; we don't keep
a separate model and try to keep them in sync.

### Library

Add `jsonc-parser` (MS, MIT) to `admin/`. We use four entry points:

- `parseTree(text)` → AST `Node` with `{ type, offset, length, children, value }`.
- `getNodePath(node)` → `(string|number)[]` JSON pointer-ish path.
- `modify(text, path, value, options)` → array of `Edit { offset, length, content }`.
- `applyEdits(text, edits)` → new text.

Comments are recoverable from the source `text` using `node.offset`;
`parseTree` skips them but their byte ranges are deterministic.

## Components

```
SettingsPage
├── ModeToggle                Form | Raw (segmented control)
│
├── FormView                  visible when mode === 'form'
│   ├── ParseErrorBanner      shown when parseTree fails
│   └── JsoncNode (recursive) one per AST node
│       ├── CommentLabel      leading /* */ or // text
│       ├── KeyLabel
│       ├── ValueWidget       dispatches on node.type
│       │   ├── StringInput
│       │   ├── NumberInput
│       │   ├── BooleanToggle
│       │   ├── NullChip
│       │   ├── EnvPill       read-only, when raw matches ${VAR:default}
│       │   ├── ObjectGroup   collapsible, recurses
│       │   └── ArrayGroup    collapsible, recurses
│       └── TrailingCommentBadge   `// inline` after the value
│
├── RawView                   visible when mode === 'raw'
│   └── <textarea className="settings"> (the existing editor)
│
└── ButtonBar
    ├── Save
    ├── Validate              dry-run JSON parse, toast result
    └── Restart               unchanged, keeps data-testid
```

`exposeExperimental` (Prettify) stays gated off, as in #7709.

### Comment binding

For each property node `"key": value`:

- "Leading comment" = the longest run of `/* */` and `//` lines whose
  byte range ends at the line break immediately before `node.offset`,
  with at most one blank line allowed between the comment block and
  the key. Rendered as the help text under `KeyLabel`.
- "Trailing comment" = a single `//` or `/* */` on the same line as
  the value, after the trailing comma if any. Rendered as a small
  badge with tooltip.
- Comments not adjacent to a key (file header, orphan blocks) render
  in raw mode only.

### Env placeholder detection

A string node whose raw text slice (`text.slice(offset, offset+length)`)
matches `/^"\$\{[^}]+\}"$/` renders as `EnvPill` instead of
`StringInput`. The pill shows the variable name and (if present) the
default after `:`. It is read-only; tooltip explains "edit in raw mode".

## Data flow

1. `settingsSocket` emits the raw file text. Store sets
   `state.settings = text` (this already happens today).
2. `FormView` calls `parseTree(state.settings)`. On any thrown
   `SyntaxError` it renders `ParseErrorBanner` and a "Switch to raw to
   fix" button instead of the tree.
3. Each leaf widget receives `(node, path)` and an `onChange(value)`
   callback. `onChange` runs:
   ```ts
   const edits = modify(state.settings, path, value, {
     formattingOptions: { tabSize: 2, insertSpaces: true }
   });
   useStore.getState().setSettings(applyEdits(state.settings, edits));
   ```
4. Re-render uses the new text. Successive edits stack naturally.
5. Save: `isJSONClean(text)` → `socket.emit('saveSettings', text)`.
6. Mode toggle does not touch `state.settings`; both views share it.

### Why no AST round-trip

We tried (in design) the alternative "parse → model → reserialize" and
rejected it: even with `jsonc-parser`'s `Edit` API at the bottom, an
intermediate model loses information about whitespace runs and
comment whitespace prefixes. Patching the original text with
`modify()` is the only path that gives byte-identical output for
untouched regions, which is the explicit requirement (admins watch
`settings.json` in git).

## Save semantics

- Form mode: each widget edit produces a `modify()` patch against the
  current text. Untouched bytes — including comments, ordering,
  trailing commas, env placeholders — are preserved.
- Raw mode: textarea writes the whole text back wholesale. New keys
  and structural reshuffles only happen here.
- The save button itself is mode-agnostic: it sends `state.settings`
  as it stands. The existing `isJSONClean` validation gates it.
- Toggling Form → Raw is always safe: text is unchanged.
- Toggling Raw → Form may surface a parse error; banner explains and
  offers to switch back.

## Error handling

| Failure                                  | UX                                                                |
| ---------------------------------------- | ----------------------------------------------------------------- |
| Server hasn't sent settings yet          | Spinner (existing behavior preserved)                             |
| Socket disconnected during save          | Failure toast `admin_settings.toast.disconnected`                 |
| Invalid JSON at save time                | Failure toast `admin_settings.toast.json_invalid`, save blocked   |
| Invalid JSON when toggling Raw → Form    | `ParseErrorBanner` with line/col, "Switch back to Raw" button     |
| `modify()` returns no edits (no-op)      | Treat as successful; widget value reflects current text           |
| Number widget non-finite/non-numeric     | Field-level inline error; file text is *not* updated until input parses; save uses last-valid value |

## i18n

All new strings go through `react-i18next`. New keys:

```
admin_settings.mode.form            "Form"
admin_settings.mode.raw             "Raw"
admin_settings.parse_error.title    "Cannot parse settings.json"
admin_settings.parse_error.cta      "Switch to raw to edit"
admin_settings.env_pill.tooltip     "Environment variable. Edit in raw mode."
admin_settings.add_key.disabled     "Add new keys in raw mode"
```

Plus the toast keys already added in #7709.

## Accessibility

- Mode toggle is a `role=tablist` with arrow-key navigation.
- Each form group has an `aria-labelledby` pointing at its key label.
- `EnvPill` is `role=note` with `aria-label="environment variable …"`.
- Collapsible groups use `<details>`/`<summary>` so keyboard and
  screen-reader behavior is native.

## Test plan (Playwright, `admin-spec/adminsettings.spec.ts`)

Add specs:

- `form view renders comment as help text` — assert that a `dbType`
  row's `aria-describedby` resolves to text containing the leading
  comment in `settings.json`.
- `editing string preserves comments` — change `title` via the form
  input, save, reload; assert raw text contains both the new title and
  the original comment block above it.
- `boolean toggle round-trips` — toggle `requireAuthentication`, save,
  reload; assert raw text shows `true`/`false` literal and surrounding
  comments unchanged.
- `env pill is read-only` — locate the SSO `issuer` row, assert pill
  is rendered, assert no `<input>` accepts text in form mode.
- `raw toggle round-trip is lossless` — Form → Raw → Form returns
  identical bytes when nothing was edited.
- `invalid raw JSON shows banner on toggle to form` — paste broken
  JSON in raw, toggle to form, assert `ParseErrorBanner`, assert
  "Switch to raw" button works.
- Existing `comments preserved after save round-trip`,
  `validate button toasts`, `restart works` specs continue to pass
  through the new helper testids.

## Out of scope (future PRs)

- Add-key / delete-key form UI.
- Env-var inline editing widget.
- Schema-driven help text overlay.
- Sectioning / search / filter.

## Rollout

Single PR replacing the current `SettingsPage.tsx` from #7709. The
takeover branch (`takeover/7666-admin-settings-editor` on
johnmclear/etherpad-lite) gets new commits on top; #7709 stays open
and gets force-updated. No server-side migration.
