# Admin /settings parsed view — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single textarea on `/admin/settings` with a parsed JSONC tree of typed widgets. Each key shows its leading `/* */` or `//` comment as inline help. Saves round-trip through `jsonc-parser`'s `modify()` so untouched bytes — comments, key order, `${ENV:default}` placeholders — survive intact. A "Raw" mode preserves the existing textarea as a fallback.

**Architecture:** Client-side only. The store holds the raw file text (single source of truth). Form view re-parses the text on each render via `jsonc-parser.parseTree`. Widget edits call `modify(text, path, value)` + `applyEdits` and write the result back to the store. Save sends the resulting text to the server through the existing `settingsSocket`. Server contract is unchanged.

**Tech Stack:** React 19, Zustand, react-i18next, `jsonc-parser` (new dep), Playwright for verification.

**Branch:** `takeover/7666-admin-settings-editor` on `johnmclear/etherpad-lite` (PR #7709). Rebase before starting if upstream `develop` has moved.

**Reference spec:** `docs/superpowers/specs/2026-05-09-admin-settings-parsed-view-design.md`.

---

## File structure

Create:

- `admin/src/components/settings/jsoncEdit.ts` — thin wrapper around `jsonc-parser.modify` + `applyEdits`.
- `admin/src/components/settings/comments.ts` — pure helpers: extract leading + trailing comment text for a given AST node from the source string.
- `admin/src/components/settings/envPill.ts` — detect `${VAR:default}` literals from a string node's raw slice.
- `admin/src/components/settings/CommentLabel.tsx` — renders leading comment as muted help text under a key.
- `admin/src/components/settings/ParseErrorBanner.tsx` — renders parse-error notice + "Switch to raw" button.
- `admin/src/components/settings/widgets/StringInput.tsx`
- `admin/src/components/settings/widgets/NumberInput.tsx`
- `admin/src/components/settings/widgets/BooleanToggle.tsx`
- `admin/src/components/settings/widgets/NullChip.tsx`
- `admin/src/components/settings/widgets/EnvPill.tsx`
- `admin/src/components/settings/widgets/ObjectGroup.tsx`
- `admin/src/components/settings/widgets/ArrayGroup.tsx`
- `admin/src/components/settings/JsoncNode.tsx` — dispatches a node to the right widget.
- `admin/src/components/settings/FormView.tsx` — top-level form: parse text, render tree, surface ParseErrorBanner.
- `admin/src/components/settings/ModeToggle.tsx` — segmented control: Form | Raw.

Modify:

- `admin/package.json` — add `jsonc-parser`.
- `admin/src/pages/SettingsPage.tsx` — restructure into ModeToggle + FormView/RawView shell.
- `admin/src/App.css` — append styles for tree, group, pill, banner, mode-toggle.
- `src/locales/en.json` — new i18n keys.
- `src/tests/frontend-new/admin-spec/adminsettings.spec.ts` — new Playwright specs (the file already exists with the regression specs from the previous commit).

---

## Task 1: Add `jsonc-parser` dependency and scaffold the directory

**Files:**
- Modify: `admin/package.json`
- Create: `admin/src/components/settings/.gitkeep` (ensures the directory exists; remove once a real file lands)

- [ ] **Step 1: Install `jsonc-parser` in `admin/`**

```bash
cd admin && pnpm add jsonc-parser@^3.3.1
```

Expected output: `+ jsonc-parser 3.3.1`. `package.json` and the lockfile both update.

- [ ] **Step 2: Sanity-check that the import resolves**

```bash
cd admin && node -e "import('jsonc-parser').then(m => console.log(Object.keys(m).sort().slice(0,8)))"
```

Expected output includes: `applyEdits`, `findNodeAtLocation`, `getNodePath`, `modify`, `parse`, `parseTree`.

- [ ] **Step 3: Commit**

```bash
git add admin/package.json ../pnpm-lock.yaml
git commit -m "admin(settings): add jsonc-parser dep"
```

---

## Task 2: Implement `envPill.ts` and `comments.ts` helpers

These are pure functions. No unit-test runner is configured in `admin/`, so we exercise them indirectly via Playwright. Keep them strictly testable: pure functions, no React.

**Files:**
- Create: `admin/src/components/settings/envPill.ts`
- Create: `admin/src/components/settings/comments.ts`

- [ ] **Step 1: Write `envPill.ts`**

```ts
// admin/src/components/settings/envPill.ts
//
// Detect `"${VAR}"` and `"${VAR:default}"` placeholders inside the raw
// slice of a string node. The slice INCLUDES the surrounding quotes,
// because jsonc-parser exposes node.offset/length over the whole literal.

export type EnvPlaceholder = {
  variable: string;
  defaultValue: string | null;
};

const RE = /^"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}"$/;

export const matchEnvPlaceholder = (rawSlice: string): EnvPlaceholder | null => {
  const m = RE.exec(rawSlice);
  if (!m) return null;
  return {
    variable: m[1],
    defaultValue: m[2] ?? null,
  };
};
```

- [ ] **Step 2: Write `comments.ts`**

```ts
// admin/src/components/settings/comments.ts
//
// Given the source text and a property's `keyOffset` (jsonc-parser's
// Node.offset for the property node), extract:
//   - `leading`: the contiguous run of `/* */` or `//` comments
//     immediately above the key. At most one blank line is allowed
//     between the comment block and the key.
//   - `trailing`: a single `// ...` or `/* ... */` on the same line
//     as the value, after any trailing comma.

export type AdjacentComments = {
  leading: string;
  trailing: string;
};

const LINE_BREAK = /\r?\n/;

const stripCommentMarkers = (raw: string): string => {
  // raw is a concatenation of comment tokens separated by newlines.
  // Drop /* */ and // markers and trim each line.
  return raw
    .split(LINE_BREAK)
    .map(line => line
      .replace(/^\s*\/\*+/, '')
      .replace(/\*+\/\s*$/, '')
      .replace(/^\s*\*\s?/, '')
      .replace(/^\s*\/\/\s?/, '')
      .trim())
    .filter(line => line.length > 0)
    .join(' ');
};

const findLeading = (text: string, keyOffset: number): string => {
  // Walk backwards from keyOffset to the start of the line containing it.
  const lineStart = text.lastIndexOf('\n', keyOffset - 1) + 1;
  let cursor = lineStart;
  let blankLineSeen = false;
  const collected: string[] = [];

  while (cursor > 0) {
    // Look at the previous line.
    const prevLineEnd = cursor - 1; // the '\n' before our cursor's line
    const prevLineStart = text.lastIndexOf('\n', prevLineEnd - 1) + 1;
    const line = text.slice(prevLineStart, prevLineEnd);
    const trimmed = line.trim();

    if (trimmed === '') {
      if (blankLineSeen) break;
      blankLineSeen = true;
      cursor = prevLineStart;
      continue;
    }

    const isComment =
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.endsWith('*/');

    if (!isComment) break;

    collected.unshift(line);
    cursor = prevLineStart;
  }

  return stripCommentMarkers(collected.join('\n'));
};

const findTrailing = (text: string, valueOffset: number, valueLength: number): string => {
  // Look from end-of-value to end-of-line for a single comment.
  const lineEnd = text.indexOf('\n', valueOffset + valueLength);
  const slice = text.slice(valueOffset + valueLength, lineEnd === -1 ? text.length : lineEnd);
  const m = /,?\s*(\/\/.*|\/\*.*?\*\/)\s*$/.exec(slice);
  return m ? stripCommentMarkers(m[1]) : '';
};

export const extractAdjacentComments = (
  text: string,
  keyOffset: number,
  valueOffset: number,
  valueLength: number,
): AdjacentComments => ({
  leading: findLeading(text, keyOffset),
  trailing: findTrailing(text, valueOffset, valueLength),
});
```

- [ ] **Step 3: Type-check**

```bash
cd admin && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add admin/src/components/settings/envPill.ts admin/src/components/settings/comments.ts
git commit -m "admin(settings): pure helpers for env pills and comment extraction"
```

---

## Task 3: Implement `jsoncEdit.ts` save helper

**Files:**
- Create: `admin/src/components/settings/jsoncEdit.ts`

- [ ] **Step 1: Write the wrapper**

```ts
// admin/src/components/settings/jsoncEdit.ts
import { applyEdits, modify, type JSONPath } from 'jsonc-parser';

const FORMATTING = {
  formattingOptions: { tabSize: 2, insertSpaces: true, eol: '\n' as const },
};

export const editJsonc = (text: string, path: JSONPath, value: unknown): string => {
  const edits = modify(text, path, value, FORMATTING);
  return edits.length === 0 ? text : applyEdits(text, edits);
};
```

- [ ] **Step 2: Type-check**

```bash
cd admin && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add admin/src/components/settings/jsoncEdit.ts
git commit -m "admin(settings): editJsonc wrapper around jsonc-parser modify"
```

---

## Task 4: Build leaf widgets

Each leaf takes `{ value, path, onChange }`. `onChange(newValue)` is wired by the parent (`JsoncNode`) to call `editJsonc` and push the new text into the store. Leaves are presentational only.

**Files:**
- Create: `admin/src/components/settings/widgets/StringInput.tsx`
- Create: `admin/src/components/settings/widgets/NumberInput.tsx`
- Create: `admin/src/components/settings/widgets/BooleanToggle.tsx`
- Create: `admin/src/components/settings/widgets/NullChip.tsx`
- Create: `admin/src/components/settings/widgets/EnvPill.tsx`

- [ ] **Step 1: `widgets/StringInput.tsx`**

```tsx
import type { JSONPath } from 'jsonc-parser';

type Props = {
  value: string;
  path: JSONPath;
  onChange: (next: string) => void;
};

export const StringInput = ({ value, path, onChange }: Props) => (
  <input
    type="text"
    className="settings-widget settings-widget-string"
    data-testid={`field-${path.join('.')}`}
    value={value}
    spellCheck={false}
    onChange={e => onChange(e.target.value)}
  />
);
```

- [ ] **Step 2: `widgets/NumberInput.tsx`**

Bad numeric input must not corrupt the file text. We hold the raw input string in local state and only call `onChange` when it parses to a finite number.

```tsx
import { useState } from 'react';
import type { JSONPath } from 'jsonc-parser';

type Props = {
  value: number;
  path: JSONPath;
  onChange: (next: number) => void;
};

export const NumberInput = ({ value, path, onChange }: Props) => {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  return (
    <input
      type="text"
      inputMode="decimal"
      className={'settings-widget settings-widget-number' + (invalid ? ' invalid' : '')}
      data-testid={`field-${path.join('.')}`}
      value={draft}
      onChange={e => {
        const next = e.target.value;
        setDraft(next);
        const parsed = Number(next);
        if (next.trim() !== '' && Number.isFinite(parsed)) {
          setInvalid(false);
          onChange(parsed);
        } else {
          setInvalid(true);
        }
      }}
    />
  );
};
```

- [ ] **Step 3: `widgets/BooleanToggle.tsx`**

The repo already uses `@radix-ui/react-switch`. Use it.

```tsx
import * as Switch from '@radix-ui/react-switch';
import type { JSONPath } from 'jsonc-parser';

type Props = {
  value: boolean;
  path: JSONPath;
  onChange: (next: boolean) => void;
};

export const BooleanToggle = ({ value, path, onChange }: Props) => (
  <Switch.Root
    checked={value}
    onCheckedChange={onChange}
    className="settings-widget settings-widget-boolean"
    data-testid={`field-${path.join('.')}`}
  >
    <Switch.Thumb className="settings-widget-boolean-thumb" />
  </Switch.Root>
);
```

- [ ] **Step 4: `widgets/NullChip.tsx`**

```tsx
import type { JSONPath } from 'jsonc-parser';

type Props = { path: JSONPath };

export const NullChip = ({ path }: Props) => (
  <span
    className="settings-widget settings-widget-null"
    data-testid={`field-${path.join('.')}`}
  >null</span>
);
```

- [ ] **Step 5: `widgets/EnvPill.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import type { JSONPath } from 'jsonc-parser';
import type { EnvPlaceholder } from '../envPill';

type Props = {
  placeholder: EnvPlaceholder;
  path: JSONPath;
};

export const EnvPill = ({ placeholder, path }: Props) => {
  const { t } = useTranslation();
  return (
    <span
      className="settings-widget settings-widget-env"
      role="note"
      title={t('admin_settings.env_pill.tooltip')}
      data-testid={`env-${path.join('.')}`}
    >
      <span className="settings-widget-env-icon" aria-hidden>ⓔ</span>
      <span className="settings-widget-env-name">{placeholder.variable}</span>
      {placeholder.defaultValue !== null && (
        <span className="settings-widget-env-default">
          {' '}default: <code>{placeholder.defaultValue}</code>
        </span>
      )}
    </span>
  );
};
```

- [ ] **Step 6: Type-check**

```bash
cd admin && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add admin/src/components/settings/widgets
git commit -m "admin(settings): leaf widgets (string, number, bool, null, env pill)"
```

---

## Task 5: Build group widgets and the dispatcher

`ObjectGroup` and `ArrayGroup` use the native `<details>`/`<summary>` for collapsibility (a11y comes for free). `JsoncNode` is the dispatcher: given an AST node it picks the right widget.

**Files:**
- Create: `admin/src/components/settings/widgets/ObjectGroup.tsx`
- Create: `admin/src/components/settings/widgets/ArrayGroup.tsx`
- Create: `admin/src/components/settings/JsoncNode.tsx`
- Create: `admin/src/components/settings/CommentLabel.tsx`

- [ ] **Step 1: `CommentLabel.tsx`**

```tsx
type Props = {
  leading: string;
  trailing: string;
  htmlId: string;
};

export const CommentLabel = ({ leading, trailing, htmlId }: Props) => {
  if (!leading && !trailing) return null;
  return (
    <div className="settings-comment" id={htmlId}>
      {leading && <span className="settings-comment-leading">{leading}</span>}
      {trailing && <span className="settings-comment-trailing"> // {trailing}</span>}
    </div>
  );
};
```

- [ ] **Step 2: `widgets/ObjectGroup.tsx`**

```tsx
import type { ReactNode } from 'react';
import type { JSONPath } from 'jsonc-parser';

type Props = {
  path: JSONPath;
  childCount: number;
  children: ReactNode;
};

export const ObjectGroup = ({ path, childCount, children }: Props) => (
  <details
    className="settings-group settings-group-object"
    data-testid={`group-${path.join('.') || 'root'}`}
    open
  >
    <summary>{`{ ${childCount} ${childCount === 1 ? 'key' : 'keys'} }`}</summary>
    <div className="settings-group-body">{children}</div>
  </details>
);
```

- [ ] **Step 3: `widgets/ArrayGroup.tsx`**

```tsx
import type { ReactNode } from 'react';
import type { JSONPath } from 'jsonc-parser';

type Props = {
  path: JSONPath;
  childCount: number;
  children: ReactNode;
};

export const ArrayGroup = ({ path, childCount, children }: Props) => (
  <details
    className="settings-group settings-group-array"
    data-testid={`group-${path.join('.') || 'root'}`}
    open
  >
    <summary>{`[ ${childCount} ${childCount === 1 ? 'item' : 'items'} ]`}</summary>
    <div className="settings-group-body">{children}</div>
  </details>
);
```

- [ ] **Step 4: `JsoncNode.tsx`**

This is the only place that decides which widget renders. It receives a `Node` (from `parseTree`), the source text (so it can pull raw slices for env detection and comments), and an `onEdit` callback.

```tsx
import type { JSONPath, Node } from 'jsonc-parser';
import { getNodePath } from 'jsonc-parser';
import { CommentLabel } from './CommentLabel';
import { extractAdjacentComments } from './comments';
import { matchEnvPlaceholder } from './envPill';
import { StringInput } from './widgets/StringInput';
import { NumberInput } from './widgets/NumberInput';
import { BooleanToggle } from './widgets/BooleanToggle';
import { NullChip } from './widgets/NullChip';
import { EnvPill } from './widgets/EnvPill';
import { ObjectGroup } from './widgets/ObjectGroup';
import { ArrayGroup } from './widgets/ArrayGroup';

type Props = {
  /** The value node (not the property node). */
  node: Node;
  /** The property node, when this value is the value-side of `"key": value`. */
  property?: Node;
  text: string;
  onEdit: (path: JSONPath, value: unknown) => void;
};

export const JsoncNode = ({ node, property, text, onEdit }: Props) => {
  const path = getNodePath(node);

  // Comment lookup is based on the property node when present (object child),
  // otherwise the value node directly (array element / root).
  const anchor = property ?? node;
  const { leading, trailing } = extractAdjacentComments(
    text,
    anchor.offset,
    node.offset,
    node.length,
  );
  const commentId = `settings-comment-${path.join('.') || 'root'}`;

  const wrap = (label: React.ReactNode, control: React.ReactNode) => (
    <div className="settings-row" aria-describedby={commentId}>
      {label && <span className="settings-key">{label}</span>}
      <span className="settings-value">{control}</span>
      <CommentLabel leading={leading} trailing={trailing} htmlId={commentId} />
    </div>
  );

  // Property name for object children:
  const keyLabel =
    property?.type === 'property' && property.children?.[0]?.type === 'string'
      ? String(property.children[0].value)
      : null;

  if (node.type === 'object') {
    return wrap(
      keyLabel,
      <ObjectGroup path={path} childCount={node.children?.length ?? 0}>
        {(node.children ?? []).map((prop, i) => {
          const valueNode = prop.children?.[1];
          if (!valueNode) return null;
          return (
            <JsoncNode
              key={i}
              node={valueNode}
              property={prop}
              text={text}
              onEdit={onEdit}
            />
          );
        })}
      </ObjectGroup>,
    );
  }

  if (node.type === 'array') {
    return wrap(
      keyLabel,
      <ArrayGroup path={path} childCount={node.children?.length ?? 0}>
        {(node.children ?? []).map((child, i) => (
          <JsoncNode key={i} node={child} text={text} onEdit={onEdit} />
        ))}
      </ArrayGroup>,
    );
  }

  if (node.type === 'string') {
    const raw = text.slice(node.offset, node.offset + node.length);
    const env = matchEnvPlaceholder(raw);
    if (env) return wrap(keyLabel, <EnvPill placeholder={env} path={path} />);
    return wrap(
      keyLabel,
      <StringInput
        value={String(node.value)}
        path={path}
        onChange={v => onEdit(path, v)}
      />,
    );
  }

  if (node.type === 'number') {
    return wrap(
      keyLabel,
      <NumberInput
        value={Number(node.value)}
        path={path}
        onChange={v => onEdit(path, v)}
      />,
    );
  }

  if (node.type === 'boolean') {
    return wrap(
      keyLabel,
      <BooleanToggle
        value={Boolean(node.value)}
        path={path}
        onChange={v => onEdit(path, v)}
      />,
    );
  }

  if (node.type === 'null') {
    return wrap(keyLabel, <NullChip path={path} />);
  }

  // 'property' nodes are handled by their parent object branch above.
  return null;
};
```

- [ ] **Step 5: Type-check**

```bash
cd admin && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add admin/src/components/settings
git commit -m "admin(settings): group widgets, JsoncNode dispatcher, CommentLabel"
```

---

## Task 6: Build `FormView`, `ParseErrorBanner`, `ModeToggle`

**Files:**
- Create: `admin/src/components/settings/FormView.tsx`
- Create: `admin/src/components/settings/ParseErrorBanner.tsx`
- Create: `admin/src/components/settings/ModeToggle.tsx`

- [ ] **Step 1: `ParseErrorBanner.tsx`**

```tsx
import { Trans } from 'react-i18next';

type Props = {
  message: string;
  onSwitchToRaw: () => void;
};

export const ParseErrorBanner = ({ message, onSwitchToRaw }: Props) => (
  <div className="settings-parse-error" role="alert" data-testid="parse-error-banner">
    <strong><Trans i18nKey="admin_settings.parse_error.title" /></strong>
    <pre className="settings-parse-error-detail">{message}</pre>
    <button type="button" onClick={onSwitchToRaw} data-testid="parse-error-switch-raw">
      <Trans i18nKey="admin_settings.parse_error.cta" />
    </button>
  </div>
);
```

- [ ] **Step 2: `FormView.tsx`**

```tsx
import { parseTree, type JSONPath, type ParseError } from 'jsonc-parser';
import { useStore } from '../../store/store';
import { editJsonc } from './jsoncEdit';
import { JsoncNode } from './JsoncNode';
import { ParseErrorBanner } from './ParseErrorBanner';

type Props = {
  onSwitchToRaw: () => void;
};

const formatErrors = (errors: ParseError[]): string =>
  errors.length === 0
    ? ''
    : errors.map(e => `offset ${e.offset}: ${ParseErrorMessage[e.error] ?? 'parse error'}`).join('\n');

const ParseErrorMessage: Record<number, string> = {
  1: 'Invalid symbol',
  2: 'Invalid number format',
  3: 'Property name expected',
  4: 'Value expected',
  5: 'Colon expected',
  6: 'Comma expected',
  7: 'Closing brace expected',
  8: 'Closing bracket expected',
  9: 'End of file expected',
  16: 'Unexpected end of comment',
  17: 'Unexpected end of string',
  18: 'Unexpected end of number',
  19: 'Invalid unicode',
  20: 'Invalid escape character',
  21: 'Invalid character',
};

export const FormView = ({ onSwitchToRaw }: Props) => {
  const text = useStore(s => s.settings) ?? '';

  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true });

  const onEdit = (path: JSONPath, value: unknown) => {
    useStore.getState().setSettings(editJsonc(text, path, value));
  };

  if (!tree || errors.length > 0) {
    return <ParseErrorBanner message={formatErrors(errors)} onSwitchToRaw={onSwitchToRaw} />;
  }

  return (
    <div className="settings-form" data-testid="settings-form-view">
      <JsoncNode node={tree} text={text} onEdit={onEdit} />
    </div>
  );
};
```

- [ ] **Step 3: `ModeToggle.tsx`**

```tsx
import { Trans } from 'react-i18next';

export type Mode = 'form' | 'raw';

type Props = {
  mode: Mode;
  onChange: (mode: Mode) => void;
};

export const ModeToggle = ({ mode, onChange }: Props) => (
  <div className="settings-mode-toggle" role="tablist" aria-label="Editor mode">
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'form'}
      data-testid="mode-toggle-form"
      className={mode === 'form' ? 'active' : ''}
      onClick={() => onChange('form')}
    >
      <Trans i18nKey="admin_settings.mode.form" />
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'raw'}
      data-testid="mode-toggle-raw"
      className={mode === 'raw' ? 'active' : ''}
      onClick={() => onChange('raw')}
    >
      <Trans i18nKey="admin_settings.mode.raw" />
    </button>
  </div>
);
```

- [ ] **Step 4: Type-check**

```bash
cd admin && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/settings
git commit -m "admin(settings): FormView, ParseErrorBanner, ModeToggle"
```

---

## Task 7: Restructure `SettingsPage.tsx`

The page becomes a shell that toggles between `FormView` and the existing raw textarea. Save / Validate / Restart and the Prettify feature flag stay where they were in the previous commit.

**Files:**
- Modify: `admin/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import React, { useState } from 'react';
import { useStore } from '../store/store';
import { isJSONClean, cleanComments } from '../utils/utils';
import { Trans, useTranslation } from 'react-i18next';
import { IconButton } from '../components/IconButton';
import { RotateCw, Save, AlignLeft, ShieldCheck } from 'lucide-react';
import { FormView } from '../components/settings/FormView';
import { ModeToggle, type Mode } from '../components/settings/ModeToggle';

const TAB_INDENT = '  ';

export const SettingsPage = () => {
  const { t } = useTranslation();
  const settingsSocket = useStore(state => state.settingsSocket);
  const settings = useStore(state => state.settings) ?? '';

  const [mode, setMode] = useState<Mode>('form');
  const [exposeExperimental] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const target = e.currentTarget;
    const { selectionStart, selectionEnd, value } = target;
    const next = value.substring(0, selectionStart) + TAB_INDENT + value.substring(selectionEnd);
    useStore.getState().setSettings(next);
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = selectionStart + TAB_INDENT.length;
    });
  };

  const showToast = (titleKey: string, success: boolean) => {
    useStore.getState().setToastState({ open: true, title: t(titleKey), success });
  };

  const testJSON = () => {
    if (isJSONClean(settings)) showToast('admin_settings.toast.validation_ok', true);
    else showToast('admin_settings.toast.validation_failed', false);
  };

  const prettifyJSON = () => {
    try {
      const obj = JSON.parse(cleanComments(settings) ?? '');
      if (window.confirm(t('admin_settings.prettify_confirm'))) {
        useStore.getState().setSettings(JSON.stringify(obj, null, 2));
      }
    } catch {
      showToast('admin_settings.toast.prettify_failed', false);
    }
  };

  const handleSave = () => {
    if (!isJSONClean(settings)) return showToast('admin_settings.toast.json_invalid', false);
    if (!settingsSocket?.connected) return showToast('admin_settings.toast.disconnected', false);
    settingsSocket.emit('saveSettings', settings);
    showToast('admin_settings.toast.saved', true);
  };

  return (
    <div className="settings-page">
      <h1><Trans i18nKey="admin_settings.current" /></h1>

      <ModeToggle mode={mode} onChange={setMode} />

      {mode === 'form'
        ? <FormView onSwitchToRaw={() => setMode('raw')} />
        : (
          <textarea
            value={settings}
            className="settings"
            data-testid="settings-raw-textarea"
            spellCheck={false}
            onKeyDown={handleKeyDown}
            onChange={v => useStore.getState().setSettings(v.target.value)}
          />
        )
      }

      <div className="settings-button-bar">
        <IconButton
          className="settingsButton"
          data-testid="save-settings-button"
          icon={<Save />}
          title={<Trans i18nKey="admin_settings.current_save.value" />}
          onClick={handleSave}
        />
        <IconButton
          className="settingsButton"
          data-testid="test-settings-button"
          icon={<ShieldCheck />}
          title={<Trans i18nKey="admin_settings.current_test.value" />}
          onClick={testJSON}
        />
        {exposeExperimental && (
          <IconButton
            className="settingsButton"
            data-testid="prettify-settings-button"
            icon={<AlignLeft />}
            title={<Trans i18nKey="admin_settings.current_prettify.value" />}
            onClick={prettifyJSON}
          />
        )}
        <IconButton
          className="settingsButton"
          data-testid="restart-etherpad-button"
          icon={<RotateCw />}
          title={<Trans i18nKey="admin_settings.current_restart.value" />}
          onClick={() => settingsSocket?.emit('restartServer')}
        />
      </div>

      <div className="settings-links">
        <a rel="noopener noreferrer" target="_blank" href="//github.com/ether/etherpad/wiki/Example-Production-Settings.JSON">
          <Trans i18nKey="admin_settings.current_example-prod" />
        </a>
        <a rel="noopener noreferrer" target="_blank" href="//github.com/ether/etherpad/wiki/Example-Development-Settings.JSON">
          <Trans i18nKey="admin_settings.current_example-devel" />
        </a>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
cd admin && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Build**

```bash
cd admin && npx vite build --outDir ../src/templates/admin --emptyOutDir
```

Expected: build completes; the only warning may be the existing chunk-size warning.

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/SettingsPage.tsx
git commit -m "admin(settings): toggle FormView and raw textarea from SettingsPage"
```

---

## Task 8: CSS

**Files:**
- Modify: `admin/src/App.css`

- [ ] **Step 1: Append the styles**

```css
/* --- mode toggle --- */
.settings-mode-toggle {
  display: inline-flex;
  border: 1px solid #444;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 12px;
}
.settings-mode-toggle button {
  padding: 6px 14px;
  border: 0;
  background: transparent;
  color: #d4d4d4;
  cursor: pointer;
}
.settings-mode-toggle button.active {
  background: #007acc;
  color: #fff;
}

/* --- form tree --- */
.settings-form {
  font-family: "Fira Code", "Cascadia Code", "Source Code Pro", monospace;
  font-size: 13px;
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 12px;
  border: 1px solid #333;
  border-radius: 4px;
}
.settings-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}
.settings-key {
  font-weight: 600;
  color: #9cdcfe;
}
.settings-value {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.settings-comment {
  font-style: italic;
  color: #6a9955;
  white-space: pre-wrap;
}
.settings-comment-trailing {
  color: #808080;
  font-style: normal;
}

/* --- group widgets --- */
.settings-group > summary {
  cursor: pointer;
  color: #c586c0;
}
.settings-group-body {
  padding-left: 16px;
  border-left: 1px solid #333;
  margin-left: 4px;
}

/* --- leaf widgets --- */
.settings-widget-string,
.settings-widget-number {
  background: #2d2d2d;
  color: #d4d4d4;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 2px 6px;
  font-family: inherit;
  font-size: inherit;
  min-width: 220px;
}
.settings-widget-number.invalid {
  border-color: #ce5050;
}
.settings-widget-null {
  color: #569cd6;
  font-style: italic;
}
.settings-widget-env {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #2d2d4d;
  color: #d4d4d4;
  border: 1px dashed #5577aa;
  border-radius: 12px;
  padding: 1px 8px;
}
.settings-widget-env code {
  background: transparent;
  color: #ce9178;
}

/* --- parse error --- */
.settings-parse-error {
  border: 1px solid #ce5050;
  background: #3a1f1f;
  color: #fdd;
  padding: 12px;
  border-radius: 4px;
}
.settings-parse-error-detail {
  white-space: pre-wrap;
  font-family: inherit;
}
.settings-parse-error button {
  margin-top: 8px;
  background: #ce5050;
  color: #fff;
  border: 0;
  padding: 6px 12px;
  border-radius: 3px;
  cursor: pointer;
}
```

- [ ] **Step 2: Commit**

```bash
git add admin/src/App.css
git commit -m "admin(settings): styles for tree, widgets, env pill, parse error"
```

---

## Task 9: i18n keys

**Files:**
- Modify: `src/locales/en.json`

- [ ] **Step 1: Add keys after the existing `admin_settings.*` block**

Insert the following lines next to the other `admin_settings.toast.*` keys (already added in the previous commit):

```json
"admin_settings.mode.form": "Form",
"admin_settings.mode.raw": "Raw",
"admin_settings.parse_error.title": "Cannot parse settings.json",
"admin_settings.parse_error.cta": "Switch to raw to edit",
"admin_settings.env_pill.tooltip": "Environment variable. Edit in raw mode.",
```

- [ ] **Step 2: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('src/locales/en.json','utf8'))"
```

Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/locales/en.json
git commit -m "admin(settings): i18n keys for form mode, parse error, env pill"
```

---

## Task 10: Playwright specs (TDD: write first, satisfy second)

These are the verification gate. Write all of them, run, see failures unrelated to logic (e.g. selectors), tighten until they pass.

**Files:**
- Modify: `src/tests/frontend-new/admin-spec/adminsettings.spec.ts`

The existing file already contains: `Are Settings visible…`, `preserves /* */ comments after save round-trip`, `validate button toasts…`, `restart works`. Append these inside `test.describe('admin settings', …)`:

- [ ] **Step 1: Append `comment is rendered as help text` spec**

```ts
test('form view renders leading comment as help text for known key', async ({page}) => {
  await page.goto('http://localhost:9001/admin/settings');
  await page.getByTestId('mode-toggle-form').click();
  await page.waitForSelector('[data-testid="settings-form-view"]');
  // settings.json ships with a leading comment above `dbType` (or `title`).
  // Assert that *some* row exposes a non-empty `.settings-comment-leading`.
  const firstComment = page.locator('.settings-comment-leading').first();
  await expect(firstComment).toBeVisible({timeout: 10000});
  expect((await firstComment.textContent())?.trim().length ?? 0).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Append `editing a string field round-trips` spec**

```ts
test('editing title via form input round-trips through save', async ({page}) => {
  await page.goto('http://localhost:9001/admin/settings');
  await page.getByTestId('mode-toggle-raw').click();
  const raw = page.getByTestId('settings-raw-textarea');
  const original = await raw.inputValue();

  await page.getByTestId('mode-toggle-form').click();
  const titleField = page.getByTestId('field-title');
  await expect(titleField).toBeVisible({timeout: 10000});
  await titleField.fill('Etherpad-Form-Edit');
  await page.getByTestId('save-settings-button').click();
  await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});

  await page.reload();
  await page.getByTestId('mode-toggle-raw').click();
  const after = await page.getByTestId('settings-raw-textarea').inputValue();
  expect(after).toContain('"title": "Etherpad-Form-Edit"');
  // Comments above title must survive
  const titleIdx = after.indexOf('"title"');
  expect(after.slice(0, titleIdx)).toMatch(/\/\*[\s\S]*?\*\//);

  // Restore
  await page.getByTestId('settings-raw-textarea').fill(original);
  await page.getByTestId('save-settings-button').click();
  await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});
});
```

- [ ] **Step 3: Append `boolean toggle round-trips` spec**

```ts
test('boolean toggle round-trips through save', async ({page}) => {
  await page.goto('http://localhost:9001/admin/settings');
  await page.getByTestId('mode-toggle-raw').click();
  const original = await page.getByTestId('settings-raw-textarea').inputValue();

  await page.getByTestId('mode-toggle-form').click();
  const toggle = page.getByTestId('field-requireAuthentication');
  await expect(toggle).toBeVisible({timeout: 10000});
  const before = await toggle.getAttribute('aria-checked');
  await toggle.click();
  await page.getByTestId('save-settings-button').click();
  await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});

  await page.reload();
  await page.getByTestId('mode-toggle-form').click();
  const after = await page.getByTestId('field-requireAuthentication').getAttribute('aria-checked');
  expect(after).not.toEqual(before);

  // Restore
  await page.getByTestId('mode-toggle-raw').click();
  await page.getByTestId('settings-raw-textarea').fill(original);
  await page.getByTestId('save-settings-button').click();
  await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});
});
```

- [ ] **Step 4: Append `env placeholder renders as read-only pill` spec**

```ts
test('env placeholder renders as read-only pill (no input)', async ({page}) => {
  await page.goto('http://localhost:9001/admin/settings');
  await page.getByTestId('mode-toggle-form').click();
  await page.waitForSelector('[data-testid="settings-form-view"]');
  // settings.json ships ${SSO_ISSUER:http://localhost:9001} on sso.issuer
  const pill = page.getByTestId('env-sso.issuer');
  await expect(pill).toBeVisible({timeout: 10000});
  // No <input> exists for that path
  await expect(page.getByTestId('field-sso.issuer')).toHaveCount(0);
});
```

- [ ] **Step 5: Append `raw → form on broken JSON shows banner` spec**

```ts
test('toggling form on broken raw JSON shows parse error banner', async ({page}) => {
  await page.goto('http://localhost:9001/admin/settings');
  await page.getByTestId('mode-toggle-raw').click();
  const raw = page.getByTestId('settings-raw-textarea');
  const original = await raw.inputValue();

  await raw.fill('{ "broken":');
  await page.getByTestId('mode-toggle-form').click();
  await expect(page.getByTestId('parse-error-banner')).toBeVisible();

  // CTA returns to raw view
  await page.getByTestId('parse-error-switch-raw').click();
  await expect(raw).toBeVisible();

  // Restore
  await raw.fill(original);
  await page.getByTestId('save-settings-button').click();
  await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});
});
```

- [ ] **Step 6: Run the new specs locally**

```bash
cd src && npx playwright test admin-spec/adminsettings.spec.ts --reporter=line
```

Expected: all specs pass. (Do NOT use `--headed` — see CLAUDE memory.)

If a spec fails because `settings.json` doesn't ship with the assumed key (e.g. `dbType`, `title`, `sso.issuer`), update the spec to a key that *is* present in the shipped settings.json. Do not change widget code to satisfy a spec that's looking at the wrong key.

- [ ] **Step 7: Commit**

```bash
git add src/tests/frontend-new/admin-spec/adminsettings.spec.ts
git commit -m "admin(settings): playwright specs for form view, env pill, parse error, round-trip"
```

---

## Task 11: Manual smoke + push

- [ ] **Step 1: Start dev server**

```bash
cd src && NODE_ENV=development node --require tsx/cjs node/server.ts
```

Login at http://localhost:9001/admin/login as `admin` / `changeme1`, go to `/admin/settings`. Verify by hand:

1. Form mode is the default; tree renders with collapsible groups.
2. Comments appear under their keys.
3. SSO issuer renders as a pill, not a text input.
4. Edit `title`, click Save, reload — change persists, comments survive.
5. Toggle to Raw — textarea contains the file, comments intact.
6. Break the JSON in raw, toggle to Form — banner appears, "Switch to raw" returns you.
7. Tab key in raw still inserts spaces.
8. Restart button still works (requires the dev server to come back up; `Ctrl-C` if you don't want to wait).

- [ ] **Step 2: Push**

```bash
git push fork takeover/7666-admin-settings-editor
```

- [ ] **Step 3: Update PR #7709 title and body**

```bash
gh pr edit 7709 --repo ether/etherpad \
  --title "admin: parsed JSONC settings editor (takes over #7666, closes #7603)" \
  --body-file <(cat <<'EOF'
Replaces the textarea on `/admin/settings` with a parsed JSONC tree:
each key is rendered with the right typed widget (string input, number,
toggle, env pill, collapsible object/array) and its leading `/* */`
comment surfaces as inline help. A "Raw" mode toggle keeps the existing
textarea editor behind it for power users and structural edits.

Round-trip is byte-identical for untouched regions: edits go through
`jsonc-parser`'s `modify()` so comments, key order, whitespace, and
`${ENV:default}` placeholders all survive.

Takes over #7666 (original author AWOL). Closes #7603.

## Spec / plan
- Design: `docs/superpowers/specs/2026-05-09-admin-settings-parsed-view-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-admin-settings-parsed-view.md`

## Tests
- Existing specs (comments-preserved, validate, restart) continue to
  pass; restart now keys off `data-testid` instead of `.nth(1)`.
- New: form renders comment as help text; string round-trips through
  save; boolean toggle round-trips; env placeholder renders as pill;
  broken raw JSON surfaces a parse-error banner with a "Switch to raw"
  CTA.

## Out of scope (follow-ups)
- Add/remove keys from the form (raw mode is the escape hatch).
- Editing `${VAR:default}` placeholders in form mode.
- Schema-driven help text.

## Semver
patch — admin UI only, no API or settings-file format changes.
EOF
)
```

- [ ] **Step 4: Re-trigger Qodo review**

```bash
gh pr comment 7709 --repo ether/etherpad --body "/review"
```

- [ ] **Step 5: Install on local etherpad and share test URL with John**

(Skipped — already running in this session at http://localhost:9001/admin/settings)

---

## Self-review checklist (for the executor)

After completing all tasks, before declaring done:

- [ ] `cd admin && npx tsc --noEmit` exits 0.
- [ ] `cd admin && npx vite build --outDir ../src/templates/admin --emptyOutDir` succeeds.
- [ ] `cd src && npx playwright test admin-spec/adminsettings.spec.ts --reporter=line` is green.
- [ ] `git diff develop --stat` shows only files in `admin/src/`, `admin/package.json`, `pnpm-lock.yaml`, `src/locales/en.json`, `src/templates/admin/` (build output), `src/tests/frontend-new/admin-spec/adminsettings.spec.ts`, `src/tests/frontend-new/helper/adminhelper.ts`, and the docs/superpowers/ files.
- [ ] No `console.log` or `debugger` left in `admin/src/components/settings/`.
- [ ] No fabricated comments referencing the PR / task / "FIX:" / "John" in source files.
- [ ] PR body updated and `/review` posted.
