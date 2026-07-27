# admin/settings resolved runtime values — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make /admin/settings show resolved env-var values alongside the raw `${VAR:default}` template, so operators see what Etherpad is actually running with.

**Architecture:** Server emits a new `resolved` field on the existing `'settings'` socket event — the in-memory `settings` module passed through a secrets redactor. Client stores it alongside the raw file blob and uses it to render a `→ value` chip inside the existing EnvPill widget. `saveSettings` round-trip is unchanged so template literals stay intact on disk.

**Tech Stack:** TypeScript, Node 22+, socket.io, React 18, jsonc-parser, mocha (backend tests), `node:test` via tsx (admin tests), Playwright (e2e).

**Working tree:** `/home/jose/etherpad/etherpad-issue-7803`
**Branch:** `7803-admin-settings-resolved-runtime`
**Spec:** `docs/superpowers/specs/2026-05-18-admin-settings-resolved-runtime-design.md`
**Issue:** [ether/etherpad#7803](https://github.com/ether/etherpad/issues/7803)

---

## File Structure

**New files:**
- `src/node/utils/AdminSettingsRedact.ts` — pure redactor
- `src/tests/backend/specs/admin/adminSettingsRedact.ts` — mocha unit tests
- `src/tests/backend/specs/admin/adminSettingsResolved.ts` — mocha socket integration test
- `admin/src/utils/resolveByPath.ts` — JSON path walker
- `admin/src/utils/__tests__/resolveByPath.test.ts` — `node:test` unit tests
- `admin/src/components/settings/widgets/__tests__/EnvPill.test.tsx` — `node:test` component tests
- `src/tests/frontend/specs/admin-settings-resolved.spec.ts` — Playwright e2e

**Modified files:**
- `src/node/hooks/express/adminsettings.ts` — emit `resolved` field
- `admin/src/store/store.ts` — store + selector for `resolved`
- `admin/src/components/settings/widgets/EnvPill.tsx` — add `resolvedValue` prop + chip
- `admin/src/components/settings/JsoncNode.tsx` — pass resolved value to EnvPill
- `src/locales/en.json` — new i18n keys

---

## Task 1: Redactor — failing test

**Files:**
- Create: `src/tests/backend/specs/admin/adminSettingsRedact.ts`

- [ ] **Step 1: Write the failing test file**

```ts
'use strict';

import {strict as assert} from 'assert';
import {redactSettings} from '../../../../node/utils/AdminSettingsRedact';

describe('AdminSettingsRedact', function () {
  it('returns a deep clone, never mutates input', function () {
    const input = {dbSettings: {password: 'secret'}};
    const out = redactSettings(input) as any;
    assert.equal(input.dbSettings.password, 'secret');
    assert.equal(out.dbSettings.password, '[REDACTED]');
    assert.notEqual(out.dbSettings, input.dbSettings);
  });

  it('redacts users.*.password and users.*.passwordHash', function () {
    const out = redactSettings({
      users: {
        admin: {password: 'p1', is_admin: true},
        bob: {passwordHash: 'bcrypt$...'},
      },
    }) as any;
    assert.equal(out.users.admin.password, '[REDACTED]');
    assert.equal(out.users.admin.is_admin, true); // sibling preserved
    assert.equal(out.users.bob.passwordHash, '[REDACTED]');
  });

  it('redacts users.*.hash (older spelling)', function () {
    const out = redactSettings({users: {alice: {hash: 'old$...'}}}) as any;
    assert.equal(out.users.alice.hash, '[REDACTED]');
  });

  it('redacts dbSettings.password and dbSettings.user', function () {
    const out = redactSettings({
      dbSettings: {host: 'localhost', user: 'etherpad', password: 'secret', filename: '/data/etherpad.db'},
    }) as any;
    assert.equal(out.dbSettings.password, '[REDACTED]');
    assert.equal(out.dbSettings.user, '[REDACTED]');
    assert.equal(out.dbSettings.host, 'localhost');
    assert.equal(out.dbSettings.filename, '/data/etherpad.db'); // NOT redacted
  });

  it('redacts sso.clients[*].client_secret and .secret', function () {
    const out = redactSettings({
      sso: {
        clients: [
          {client_id: 'app1', client_secret: 'shhh'},
          {client_id: 'app2', secret: 'older-style'},
        ],
      },
    }) as any;
    assert.equal(out.sso.clients[0].client_secret, '[REDACTED]');
    assert.equal(out.sso.clients[0].client_id, 'app1');
    assert.equal(out.sso.clients[1].secret, '[REDACTED]');
    assert.equal(out.sso.clients[1].client_id, 'app2');
  });

  it('redacts top-level sessionKey', function () {
    const out = redactSettings({sessionKey: 'sign-me'}) as any;
    assert.equal(out.sessionKey, '[REDACTED]');
  });

  it('emits [REDACTED] sentinel for null/unset secret values', function () {
    const out = redactSettings({dbSettings: {password: null}}) as any;
    assert.equal(out.dbSettings.password, '[REDACTED]');
  });

  it('drops functions and other non-serialisable values', function () {
    const out = redactSettings({
      port: 9001,
      reloadSettings: () => {},
      dbSettings: {password: 'x'},
    }) as any;
    assert.equal(out.port, 9001);
    assert.equal(out.reloadSettings, undefined);
    assert.equal(out.dbSettings.password, '[REDACTED]');
  });

  it('leaves non-sensitive keys untouched', function () {
    const input = {
      port: 9001,
      ip: '0.0.0.0',
      loglevel: 'INFO',
      trustProxy: false,
      defaultPadText: 'Welcome!',
    };
    const out = redactSettings(input) as any;
    assert.deepEqual(out, input);
  });

  it('handles deeply nested arrays of objects', function () {
    const out = redactSettings({
      sso: {clients: [{nested: {client_secret: 'nope'}}]},
    }) as any;
    // client_secret only matches at sso.clients[*].client_secret, not nested deeper.
    assert.equal(out.sso.clients[0].nested.client_secret, 'nope');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/jose/etherpad/etherpad-issue-7803
pnpm install
cd src && pnpm exec mocha --require ts-node/register tests/backend/specs/admin/adminSettingsRedact.ts
```

Expected: FAIL with `Cannot find module ... AdminSettingsRedact`.

> **Note for executor:** If `pnpm exec mocha` is not the project's way to invoke mocha, mirror whatever pattern the sibling tests use — check `package.json` script `test:backend` and other files in `src/tests/backend/specs/admin/` to find the canonical invocation.

---

## Task 2: Redactor — implementation

**Files:**
- Create: `src/node/utils/AdminSettingsRedact.ts`

- [ ] **Step 1: Implement the redactor**

```ts
// src/node/utils/AdminSettingsRedact.ts
//
// Produce a clone of the in-memory settings object suitable for emitting
// to the admin SPA. Secrets are replaced with the sentinel "[REDACTED]"
// so the runtime values surface in the UI without leaking credentials.

const SENTINEL = '[REDACTED]';

// Path patterns. '*' matches any object key OR array index.
// A leaf matches if its full path equals one of these patterns.
const REDACT_PATHS: ReadonlyArray<ReadonlyArray<string>> = [
  ['users', '*', 'password'],
  ['users', '*', 'passwordHash'],
  ['users', '*', 'hash'],
  ['dbSettings', 'password'],
  ['dbSettings', 'user'],
  ['sso', 'clients', '*', 'client_secret'],
  ['sso', 'clients', '*', 'secret'],
  ['sessionKey'],
];

const pathMatches = (path: ReadonlyArray<string>): boolean => {
  for (const pattern of REDACT_PATHS) {
    if (pattern.length !== path.length) continue;
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] !== '*' && pattern[i] !== path[i]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
};

const walk = (value: unknown, path: string[]): unknown => {
  if (pathMatches(path)) return SENTINEL;
  if (value === null || value === undefined) return value;
  if (typeof value === 'function') return undefined;
  if (Array.isArray(value)) {
    return value.map((v, i) => walk(v, [...path, String(i)]));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const child = walk(v, [...path, k]);
      if (child !== undefined) out[k] = child;
    }
    return out;
  }
  // primitives
  return value;
};

export const redactSettings = (settings: unknown): unknown => walk(settings, []);
```

- [ ] **Step 2: Run tests to verify all pass**

```bash
cd /home/jose/etherpad/etherpad-issue-7803/src && pnpm exec mocha --require ts-node/register tests/backend/specs/admin/adminSettingsRedact.ts
```

Expected: all 9 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/jose/etherpad/etherpad-issue-7803
git add src/node/utils/AdminSettingsRedact.ts src/tests/backend/specs/admin/adminSettingsRedact.ts
git commit -m "$(cat <<'EOF'
feat(admin): add redactor for resolved settings payload (#7803)

Pure helper that clones the live settings module and replaces known
sensitive paths (users.*.password, dbSettings.password,
sso.clients[*].client_secret, sessionKey, …) with [REDACTED] sentinel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire redactor into adminsettings socket

**Files:**
- Modify: `src/node/hooks/express/adminsettings.ts:48-70`

- [ ] **Step 1: Add the import and emit `resolved`**

In `src/node/hooks/express/adminsettings.ts`, at the import block (line 10), add:

```ts
import {redactSettings} from '../../utils/AdminSettingsRedact';
```

Replace the `socket.on('load')` handler (lines 54-70) with:

```ts
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
        const resolved = redactSettings(settings);
        socket.emit('settings', {results: data, resolved, flags});
      }
    });
```

- [ ] **Step 2: TypeScript check**

```bash
cd /home/jose/etherpad/etherpad-issue-7803/src && pnpm exec tsc --noEmit
```

Expected: no errors related to adminsettings.ts.

---

## Task 4: Backend integration test — resolved field is emitted

**Files:**
- Create: `src/tests/backend/specs/admin/adminSettingsResolved.ts`

- [ ] **Step 1: Write the integration test**

Model after `src/tests/backend/specs/admin/anonymizeAuthorSocket.ts` for the admin socket setup boilerplate.

```ts
'use strict';

import {strict as assert} from 'assert';
import setCookieParser from 'set-cookie-parser';

const io = require('socket.io-client');
const common = require('../../common');
const settings = require('../../../../node/utils/Settings');

const adminSocket = async () => {
  settings.users = settings.users || {};
  settings.users['test-admin'] = {password: 'test-admin-password', is_admin: true};
  const saved = settings.requireAuthentication;
  settings.requireAuthentication = true;
  let res: any;
  try {
    res = await (common.agent as any)
        .get('/admin/')
        .auth('test-admin', 'test-admin-password');
  } finally {
    settings.requireAuthentication = saved;
  }
  const resCookies = setCookieParser.parse(res, {map: true});
  const reqCookieHdr = Object.entries(resCookies)
      .map(([name, cookie]: [string, any]) =>
          `${name}=${encodeURIComponent(cookie.value)}`)
      .join('; ');
  const socket = io(`${common.baseUrl}/settings`, {
    forceNew: true,
    query: {cookie: reqCookieHdr},
  });
  await new Promise<void>((res, rej) => {
    const onErr = (err: any) => { socket.off('connect', onErr); rej(err); };
    const onConn = () => { socket.off('connect_error', onErr); res(); };
    socket.once('connect', onConn);
    socket.once('connect_error', onErr);
  });
  return socket;
};

const ask = (socket: any, evt: string, payload: any, replyEvt: string) =>
    new Promise<any>((res) => {
      socket.once(replyEvt, res);
      socket.emit(evt, payload);
    });

describe('/admin/settings socket load emits resolved', function () {
  this.timeout(60000);
  let socket: any;
  let savedPwd: any;
  let savedTrust: any;
  let savedSessionKey: any;

  before(async function () {
    // Mutate the in-memory settings module so we can assert that what's
    // emitted reflects the runtime, not the file on disk.
    savedPwd = settings.dbSettings?.password;
    savedTrust = settings.trustProxy;
    savedSessionKey = settings.sessionKey;
    settings.dbSettings = settings.dbSettings || {};
    settings.dbSettings.password = 'live-password';
    settings.trustProxy = true;
    settings.sessionKey = 'live-key';
    socket = await adminSocket();
  });

  after(async function () {
    if (socket) socket.disconnect();
    if (savedPwd === undefined) delete settings.dbSettings.password;
    else settings.dbSettings.password = savedPwd;
    settings.trustProxy = savedTrust;
    settings.sessionKey = savedSessionKey;
  });

  it('emits {results, resolved, flags}', async function () {
    const reply: any = await ask(socket, 'load', null, 'settings');
    assert.ok(reply, 'reply present');
    assert.equal(typeof reply.results, 'string', 'raw file string');
    assert.equal(typeof reply.resolved, 'object', 'resolved object');
    assert.ok(reply.flags, 'flags present');
  });

  it('resolved reflects live mutated values, not the file on disk', async function () {
    const reply: any = await ask(socket, 'load', null, 'settings');
    assert.equal(reply.resolved.trustProxy, true,
        'resolved should show the in-memory trustProxy');
  });

  it('resolved redacts secrets', async function () {
    const reply: any = await ask(socket, 'load', null, 'settings');
    assert.equal(reply.resolved.dbSettings.password, '[REDACTED]');
    assert.equal(reply.resolved.sessionKey, '[REDACTED]');
  });

  it('resolved is omitted when showSettingsInAdminPage is false', async function () {
    const savedShow = settings.showSettingsInAdminPage;
    settings.showSettingsInAdminPage = false;
    try {
      const reply: any = await ask(socket, 'load', null, 'settings');
      assert.equal(reply.results, 'NOT_ALLOWED');
      assert.equal(reply.resolved, undefined);
    } finally {
      settings.showSettingsInAdminPage = savedShow;
    }
  });
});
```

- [ ] **Step 2: Run the full admin backend suite to make sure nothing regressed**

```bash
cd /home/jose/etherpad/etherpad-issue-7803/src && pnpm exec mocha --require ts-node/register --recursive tests/backend/specs/admin/
```

Expected: all admin specs PASS, including the 4 new ones.

> **If the existing admin specs use a different mocha invocation:** mirror that. Check `src/package.json` `scripts.test:backend` for the canonical command.

- [ ] **Step 3: Commit**

```bash
cd /home/jose/etherpad/etherpad-issue-7803
git add src/node/hooks/express/adminsettings.ts src/tests/backend/specs/admin/adminSettingsResolved.ts
git commit -m "$(cat <<'EOF'
feat(admin): emit redacted runtime settings on /settings socket load (#7803)

Existing 'results' raw-file blob is unchanged so the textarea editor
and saveSettings round-trip continue to preserve \${VAR:default}
literals on disk. New 'resolved' field carries the in-memory settings
module run through the redactor — admin SPA can use it to show actual
runtime values next to env-var placeholders.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Client — resolveByPath helper + test

**Files:**
- Create: `admin/src/utils/resolveByPath.ts`
- Create: `admin/src/utils/__tests__/resolveByPath.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// admin/src/utils/__tests__/resolveByPath.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveByPath } from '../resolveByPath.ts';

test('returns undefined for null/undefined root', () => {
  assert.equal(resolveByPath(null, ['a']), undefined);
  assert.equal(resolveByPath(undefined, ['a']), undefined);
});

test('walks nested object keys', () => {
  assert.equal(resolveByPath({a: {b: {c: 42}}}, ['a', 'b', 'c']), 42);
});

test('walks arrays with numeric indices', () => {
  assert.equal(resolveByPath({xs: [10, 20, 30]}, ['xs', 1]), 20);
});

test('walks mixed objects and arrays', () => {
  assert.equal(
    resolveByPath({sso: {clients: [{id: 'A'}, {id: 'B'}]}}, ['sso', 'clients', 1, 'id']),
    'B',
  );
});

test('returns undefined for missing keys', () => {
  assert.equal(resolveByPath({a: 1}, ['b']), undefined);
  assert.equal(resolveByPath({a: {b: 1}}, ['a', 'c']), undefined);
});

test('returns undefined when traversing into a primitive', () => {
  assert.equal(resolveByPath({a: 1}, ['a', 'b']), undefined);
});

test('returns the root when path is empty', () => {
  const obj = {a: 1};
  assert.equal(resolveByPath(obj, []), obj);
});

test('handles string-form numeric indices for arrays', () => {
  // jsonc-parser sometimes emits string indices.
  assert.equal(resolveByPath({xs: [10, 20]}, ['xs', '1']), 20);
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd /home/jose/etherpad/etherpad-issue-7803/admin && pnpm install
pnpm exec tsx --test src/utils/__tests__/resolveByPath.test.ts
```

Expected: FAIL (`Cannot find module './resolveByPath'`).

- [ ] **Step 3: Implement**

```ts
// admin/src/utils/resolveByPath.ts
import type { JSONPath } from 'jsonc-parser';

export const resolveByPath = (obj: unknown, path: JSONPath): unknown => {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      const i = typeof seg === 'number' ? seg : Number(seg);
      if (!Number.isInteger(i)) return undefined;
      cur = cur[i];
    } else {
      cur = (cur as Record<string, unknown>)[String(seg)];
    }
  }
  return cur;
};
```

- [ ] **Step 4: Run again to verify pass**

```bash
cd /home/jose/etherpad/etherpad-issue-7803/admin && pnpm exec tsx --test src/utils/__tests__/resolveByPath.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/jose/etherpad/etherpad-issue-7803
git add admin/src/utils/resolveByPath.ts admin/src/utils/__tests__/resolveByPath.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add resolveByPath JSONPath walker (#7803)

Pure helper for indexing into a plain-object resolved-settings payload
using a jsonc-parser JSONPath. Returns undefined on miss so callers can
fall back when an old server omitted the resolved field.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Client — store wires up `resolved`

**Files:**
- Modify: `admin/src/store/store.ts`

- [ ] **Step 1: Read the current store**

```bash
sed -n '1,80p' /home/jose/etherpad/etherpad-issue-7803/admin/src/store/store.ts
```

Identify (1) the `settings` field declaration, (2) the `setSettings` setter, (3) the socket listener that fires `setSettings(results)` on the `'settings'` event.

- [ ] **Step 2: Add `resolved` field, setter, selector hook**

In `admin/src/store/store.ts`:

Add to the state shape (alongside `settings`):
```ts
resolved: unknown | null;
setResolved: (r: unknown | null) => void;
```

Add to the store implementation initial state:
```ts
resolved: null,
setResolved: (resolved) => set({resolved}),
```

In the socket `'settings'` listener (where `setSettings(payload.results)` lives), add:
```ts
useStore.getState().setResolved(payload.resolved ?? null);
```

At the bottom of the file (or wherever existing selector hooks live), add:
```ts
import type { JSONPath } from 'jsonc-parser';
import { resolveByPath } from '../utils/resolveByPath';

export const useResolvedAt = (path: JSONPath): unknown =>
  useStore(s => resolveByPath(s.resolved, path));
```

> **Note for executor:** If the store file already imports `JSONPath` or `resolveByPath`, dedupe. If the file's pattern groups selectors elsewhere, follow that. Don't unilaterally refactor the file.

- [ ] **Step 3: Type-check**

```bash
cd /home/jose/etherpad/etherpad-issue-7803/admin && pnpm exec tsc --noEmit
```

Expected: no errors.

---

## Task 7: i18n keys

**Files:**
- Modify: `src/locales/en.json`

- [ ] **Step 1: Add the new keys**

Open `src/locales/en.json` and find the existing `admin_settings.env_pill.*` keys (around line 139-141). Add immediately after them:

```json
  "admin_settings.env_pill.runtime_label": "active value",
  "admin_settings.env_pill.runtime_tooltip": "Etherpad is currently using this value, resolved from {{variable}} or its default.",
  "admin_settings.env_pill.redacted_tooltip": "Etherpad is using a value for {{variable}}, but it is hidden because it is a secret.",
```

- [ ] **Step 2: Verify JSON parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('/home/jose/etherpad/etherpad-issue-7803/src/locales/en.json'))"
```

Expected: no output (no syntax error).

---

## Task 8: EnvPill — failing test for resolved chip

**Files:**
- Create: `admin/src/components/settings/widgets/__tests__/EnvPill.test.tsx`

- [ ] **Step 1: Check what testing-library setup admin uses**

```bash
grep -l "render\|@testing-library" /home/jose/etherpad/etherpad-issue-7803/admin/src/**/*.test.* 2>/dev/null
cat /home/jose/etherpad/etherpad-issue-7803/admin/package.json | grep -A 30 '"devDependencies"'
```

> **Decision point:** If `@testing-library/react` is already a devDependency, write a render-based test (preferred). If not, fall back to a plain function-call test that snapshot-asserts the React tree shape. The minimal version below uses `react-dom/server.renderToStaticMarkup` which needs no extra deps.

- [ ] **Step 2: Write the test using renderToStaticMarkup**

```tsx
// admin/src/components/settings/widgets/__tests__/EnvPill.test.tsx
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';

import { EnvPill } from '../EnvPill';

i18next.init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'admin_settings.env_pill.tooltip': 'env {{variable}}',
        'admin_settings.env_pill.default_label': 'default',
        'admin_settings.env_pill.input_aria': 'aria {{variable}}',
        'admin_settings.env_pill.runtime_label': 'active',
        'admin_settings.env_pill.runtime_tooltip': 'using {{variable}}',
        'admin_settings.env_pill.redacted_tooltip': 'hidden {{variable}}',
      },
    },
  },
  interpolation: { escapeValue: false },
});

const wrap = (el: React.ReactElement) =>
  renderToStaticMarkup(
    React.createElement(I18nextProvider, { i18n: i18next }, el),
  );

test('omits runtime chip when resolvedValue is undefined', () => {
  const html = wrap(React.createElement(EnvPill, {
    placeholder: { variable: 'DB_TYPE', defaultValue: 'dirty' },
    path: ['dbType'],
    onChange: () => {},
  }));
  assert.ok(!html.includes('settings-widget-env-runtime'),
    'runtime chip should be absent');
});

test('renders runtime chip with resolved value', () => {
  const html = wrap(React.createElement(EnvPill, {
    placeholder: { variable: 'DB_TYPE', defaultValue: 'dirty' },
    path: ['dbType'],
    onChange: () => {},
    resolvedValue: 'sqlite',
  } as any));
  assert.ok(html.includes('settings-widget-env-runtime'),
    'runtime chip class should appear');
  assert.ok(html.includes('sqlite'),
    'resolved value text should appear');
});

test('renders redacted chip when resolvedValue is [REDACTED]', () => {
  const html = wrap(React.createElement(EnvPill, {
    placeholder: { variable: 'DB_PASS', defaultValue: '' },
    path: ['dbSettings', 'password'],
    onChange: () => {},
    resolvedValue: '[REDACTED]',
  } as any));
  assert.ok(html.includes('settings-widget-env-runtime-redacted'),
    'redacted chip class should appear');
  assert.ok(!html.includes('[REDACTED]'),
    'literal sentinel must not be displayed to the user');
});

test('coerces non-string resolved values to display strings', () => {
  const html = wrap(React.createElement(EnvPill, {
    placeholder: { variable: 'TRUST_PROXY', defaultValue: 'false' },
    path: ['trustProxy'],
    onChange: () => {},
    resolvedValue: true,
  } as any));
  assert.ok(html.includes('true'));
});

test('renders null resolved value as the string null', () => {
  const html = wrap(React.createElement(EnvPill, {
    placeholder: { variable: 'IP', defaultValue: '' },
    path: ['ip'],
    onChange: () => {},
    resolvedValue: null,
  } as any));
  // null is meaningful (env unset, no default) — show "null" rather than swallow
  assert.ok(html.includes('null'));
});
```

- [ ] **Step 3: Run to verify fail**

```bash
cd /home/jose/etherpad/etherpad-issue-7803/admin && pnpm exec tsx --test src/components/settings/widgets/__tests__/EnvPill.test.tsx
```

Expected: all 5 tests FAIL on assertion (because EnvPill doesn't accept `resolvedValue` yet).

---

## Task 9: EnvPill — implementation

**Files:**
- Modify: `admin/src/components/settings/widgets/EnvPill.tsx`

- [ ] **Step 1: Add the `resolvedValue` prop and chip rendering**

Replace the entire file with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { JSONPath } from 'jsonc-parser';
import type { EnvPlaceholder } from '../envPill';

const REDACTED = '[REDACTED]';

type Props = {
  placeholder: EnvPlaceholder;
  path: JSONPath;
  onChange: (newDefault: string) => void;
  resolvedValue?: unknown;
};

const sanitize = (s: string) => s.replace(/[}]/g, '');

const formatDisplay = (v: unknown): string => {
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  return String(v);
};

export const EnvPill = ({ placeholder, path, onChange, resolvedValue }: Props) => {
  const { t } = useTranslation();
  const initial = placeholder.defaultValue ?? '';
  const [draft, setDraft] = useState(initial);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(initial);
  }, [initial]);

  const id = `field-${path.join('.')}`;
  const testid = `env-${path.join('.')}`;

  // Distinguish three runtime states:
  //   undefined → server didn't send resolved (old server, or path not present)
  //   '[REDACTED]' → secret hidden
  //   anything else → live runtime value
  const hasResolved = resolvedValue !== undefined;
  const isRedacted = resolvedValue === REDACTED;

  return (
    <span
      className="settings-widget settings-widget-env"
      title={t('admin_settings.env_pill.tooltip', { variable: placeholder.variable })}
    >
      <span className="settings-widget-env-icon" aria-hidden>ⓔ</span>
      <span className="settings-widget-env-name">{placeholder.variable}</span>
      <span className="settings-widget-env-default-label" aria-hidden>
        {t('admin_settings.env_pill.default_label')}
      </span>
      <input
        id={id}
        data-testid={testid}
        className="settings-widget-env-default-input"
        type="text"
        value={draft}
        spellCheck={false}
        aria-label={t('admin_settings.env_pill.input_aria', { variable: placeholder.variable })}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; }}
        onChange={e => {
          const v = sanitize(e.target.value);
          setDraft(v);
          onChange(v);
        }}
      />
      {hasResolved && !isRedacted && (
        <span
          className="settings-widget-env-runtime"
          data-testid={`env-runtime-${path.join('.')}`}
          title={t('admin_settings.env_pill.runtime_tooltip', { variable: placeholder.variable })}
        >
          <span className="settings-widget-env-runtime-arrow" aria-hidden>→</span>
          <span className="settings-widget-env-runtime-label" aria-hidden>
            {t('admin_settings.env_pill.runtime_label')}
          </span>
          <span className="settings-widget-env-runtime-value">
            {formatDisplay(resolvedValue)}
          </span>
        </span>
      )}
      {isRedacted && (
        <span
          className="settings-widget-env-runtime settings-widget-env-runtime-redacted"
          data-testid={`env-runtime-redacted-${path.join('.')}`}
          title={t('admin_settings.env_pill.redacted_tooltip', { variable: placeholder.variable })}
          aria-label={t('admin_settings.env_pill.redacted_tooltip', { variable: placeholder.variable })}
        >
          <span aria-hidden>→ ••••••</span>
        </span>
      )}
    </span>
  );
};
```

- [ ] **Step 2: Run tests to verify pass**

```bash
cd /home/jose/etherpad/etherpad-issue-7803/admin && pnpm exec tsx --test src/components/settings/widgets/__tests__/EnvPill.test.tsx
```

Expected: all 5 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/jose/etherpad/etherpad-issue-7803
git add admin/src/utils/resolveByPath.ts admin/src/utils/__tests__/resolveByPath.test.ts \
        admin/src/store/store.ts \
        admin/src/components/settings/widgets/EnvPill.tsx \
        admin/src/components/settings/widgets/__tests__/EnvPill.test.tsx \
        src/locales/en.json
git commit -m "$(cat <<'EOF'
feat(admin): show resolved runtime value chip on EnvPill (#7803)

Store now caches the resolved field from the /settings socket payload.
useResolvedAt(path) walks it via the existing jsonc-parser JSONPath.
EnvPill optionally renders a "→ active value" chip when a resolved
value is available, or a redacted indicator when the server returned
the [REDACTED] sentinel. Old-server fallback (undefined) keeps current
behaviour.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire JsoncNode to pass resolved value into EnvPill

**Files:**
- Modify: `admin/src/components/settings/JsoncNode.tsx`

- [ ] **Step 1: Plumb `resolvedValue` through the leaf render**

In `admin/src/components/settings/JsoncNode.tsx`:

Add an import at the top:
```ts
import { useResolvedAt } from '../../store/store';
```

Modify the leaf render so the EnvPill branch receives the resolved value. Either:

**Option A (preferred):** Lift the `useResolvedAt` call up into the function-component body of `JsoncNode`, then thread it into `renderLeaf`. Since `renderLeaf` is currently a free function (not a hook context), the cleanest change is to extract the env-placeholder branch out of `renderLeaf` and inline it in the component:

```tsx
// Inside JsoncNode, before the existing `// ---- Leaf row ----` comment:
const isEnvPlaceholder =
  node.type === 'string' &&
  matchEnvPlaceholder(text.slice(node.offset, node.offset + node.length)) !== null;
const resolvedForPath = useResolvedAt(path);

const renderLeafLocal = () => {
  if (node.type === 'string') {
    const raw = text.slice(node.offset, node.offset + node.length);
    const env = matchEnvPlaceholder(raw);
    if (env) {
      return (
        <EnvPill
          placeholder={env}
          path={path}
          onChange={(d) => onEdit(path, `\${${env.variable}:${d}}`)}
          resolvedValue={isEnvPlaceholder ? resolvedForPath : undefined}
        />
      );
    }
    return (
      <StringInput value={String(node.value)} path={path} onChange={v => onEdit(path, v)} />
    );
  }
  // delegate the rest of the leaf cases to the existing renderLeaf
  return renderLeaf(node, path, text, onEdit);
};
```

Then change the existing leaf row return to call `renderLeafLocal()` instead of `renderLeaf(...)`.

> **Why this shape:** `useResolvedAt` is a hook and can only be called inside a component, not inside `renderLeaf` (a free function). The branch above keeps the rest of `renderLeaf` untouched so the diff stays small.

- [ ] **Step 2: Type-check + lint**

```bash
cd /home/jose/etherpad/etherpad-issue-7803/admin && pnpm exec tsc --noEmit && pnpm exec eslint src/components/settings/JsoncNode.tsx
```

Expected: no errors, no warnings.

- [ ] **Step 3: Commit**

```bash
cd /home/jose/etherpad/etherpad-issue-7803
git add admin/src/components/settings/JsoncNode.tsx
git commit -m "$(cat <<'EOF'
feat(admin): pass resolved runtime value into EnvPill (#7803)

JsoncNode now looks up the resolved value at the current JSONPath via
useResolvedAt and threads it into EnvPill. Operators see the actual
runtime value of every env-substituted setting alongside the template.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Minimal CSS for runtime chip

**Files:**
- Modify: whichever stylesheet currently styles `.settings-widget-env-*` (grep to find it)

- [ ] **Step 1: Locate the existing env-pill styles**

```bash
cd /home/jose/etherpad/etherpad-issue-7803/admin && grep -rn "settings-widget-env" src/ --include="*.css" --include="*.scss"
```

- [ ] **Step 2: Append minimal styling for the runtime chip**

Add adjacent to the existing env-pill rules:

```css
.settings-widget-env-runtime {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
  margin-left: 0.5em;
  padding: 0.1em 0.5em;
  border-radius: 0.5em;
  background: rgba(0, 128, 0, 0.08);
  color: rgba(0, 80, 0, 0.85);
  font-size: 0.85em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.settings-widget-env-runtime-redacted {
  background: rgba(128, 128, 128, 0.12);
  color: rgba(80, 80, 80, 0.85);
}

.settings-widget-env-runtime-arrow {
  opacity: 0.6;
}

.settings-widget-env-runtime-label {
  opacity: 0.65;
  font-style: italic;
}
```

> **Why minimal:** matching the existing env-pill visual weight, no animation, no theme variables. If the file uses CSS custom properties for colours, swap the rgba() values for the equivalent tokens to keep consistency.

- [ ] **Step 3: Commit**

```bash
cd /home/jose/etherpad/etherpad-issue-7803
git add admin/src/  # or the specific css file path from grep
git commit -m "$(cat <<'EOF'
style(admin): runtime-value chip styles for EnvPill (#7803)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: End-to-end test in a browser

**Files:**
- Create: `src/tests/frontend/specs/admin-settings-resolved.spec.ts`

- [ ] **Step 1: Check the existing Playwright test setup**

```bash
ls /home/jose/etherpad/etherpad-issue-7803/src/tests/frontend/specs/ | head
cat /home/jose/etherpad/etherpad-issue-7803/playwright.config.ts 2>/dev/null || \
  cat /home/jose/etherpad/etherpad-issue-7803/src/playwright.config.ts
```

Identify (a) admin login pattern, (b) port (must be 9003 per [[feedback_test_port_9003]]), (c) how to set env vars on the server-under-test process.

- [ ] **Step 2: Write the e2e test**

```ts
// src/tests/frontend/specs/admin-settings-resolved.spec.ts
//
// Repro for #7803. With DB_TYPE=sqlite set in the server's env, the
// admin settings page must show the resolved value next to the env
// placeholder, not just the template default.

import { test, expect } from '@playwright/test';

test.describe('admin /settings resolved runtime values', () => {
  test('env pill shows resolved value chip', async ({ page }) => {
    // Note: this test depends on the server-under-test having been
    // booted with DB_TYPE set to a value distinct from the template
    // default. The Playwright config (or a per-test setup) sets this.
    await page.goto('http://localhost:9003/admin/login');
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'changeme1');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin/**');
    await page.goto('http://localhost:9003/admin/settings');

    // Switch to form view if not already.
    const formToggle = page.locator('[data-testid="settings-form-view"]').first();
    await expect(formToggle).toBeVisible({ timeout: 10000 });

    // The dbType row's env pill should expose a runtime chip whose
    // value matches the resolved DB_TYPE env var.
    const runtime = page.locator('[data-testid^="env-runtime-dbType"]');
    await expect(runtime).toBeVisible();
    await expect(runtime).toContainText(process.env.DB_TYPE || 'sqlite');
  });

  test('secret values render as redacted chip', async ({ page }) => {
    // Requires settings.json fixture that uses ${DB_PASS:secret} for
    // dbSettings.password. If the live test settings don't include
    // that placeholder we skip rather than misleadingly pass.
    await page.goto('http://localhost:9003/admin/settings');
    const redacted = page.locator('[data-testid^="env-runtime-redacted-dbSettings.password"]');
    if (await redacted.count() === 0) test.skip();
    await expect(redacted).toBeVisible();
    await expect(redacted).not.toContainText('[REDACTED]'); // sentinel not exposed
  });
});
```

- [ ] **Step 3: Run e2e**

Start the server on port 9003 with `DB_TYPE=sqlite` set, then run Playwright. If the project provides a `pnpm test:e2e` script that takes a port flag, use that; otherwise:

```bash
cd /home/jose/etherpad/etherpad-issue-7803
DB_TYPE=sqlite PORT=9003 pnpm run dev &
sleep 8
pnpm exec playwright test src/tests/frontend/specs/admin-settings-resolved.spec.ts
```

Expected: first test PASS, second test PASS-or-SKIP depending on test settings fixture.

> **If the e2e harness has its own way of declaring per-test env:** prefer that over the shell-prefix above. Check `playwright.config.ts` for `webServer.env`.

- [ ] **Step 4: Commit**

```bash
cd /home/jose/etherpad/etherpad-issue-7803
git add src/tests/frontend/specs/admin-settings-resolved.spec.ts
git commit -m "$(cat <<'EOF'
test(admin): e2e for resolved runtime value chip (#7803)

Boots a real browser against an Etherpad with DB_TYPE=sqlite set and
asserts the env pill shows '→ sqlite' rather than the template default.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Final verification + PR

- [ ] **Step 1: Run backend tests**

```bash
cd /home/jose/etherpad/etherpad-issue-7803/src && pnpm exec mocha --require ts-node/register --recursive tests/backend/specs/admin/
```

Expected: all PASS.

- [ ] **Step 2: Run admin frontend tests**

```bash
cd /home/jose/etherpad/etherpad-issue-7803/admin && pnpm test
```

Expected: all PASS.

- [ ] **Step 3: Run lint and tsc**

```bash
cd /home/jose/etherpad/etherpad-issue-7803/admin && pnpm exec tsc --noEmit && pnpm exec eslint .
cd /home/jose/etherpad/etherpad-issue-7803/src  && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Push branch and open PR**

```bash
cd /home/jose/etherpad/etherpad-issue-7803
git push -u origin 7803-admin-settings-resolved-runtime
gh pr create --base develop \
  --title "fix(admin): show resolved runtime values on /admin/settings (#7803)" \
  --body "$(cat <<'EOF'
## Summary
- Server emits an additional \`resolved\` field on the \`/settings\` socket \`load\` event: the in-memory settings module run through a secrets redactor. Existing \`results\` raw-file blob is unchanged so the textarea editor and \`saveSettings\` round-trip keep \`\${VAR:default}\` literals intact on disk.
- Admin SPA stores the resolved object alongside the raw text. EnvPill renders a \`→ active value\` chip when a resolved value is available, or \`→ ••••••\` when the server returned the \`[REDACTED]\` sentinel.
- Fixes #7803 — operators running Etherpad under Docker / Kubernetes / Home Assistant can now verify the actual runtime config from the admin UI instead of having to grep the boot log.

## Test plan
- [ ] Backend mocha admin specs pass, including new redactor unit tests and socket integration test.
- [ ] Admin frontend \`node:test\` suite passes, including new EnvPill + resolveByPath tests.
- [ ] Playwright e2e: with \`DB_TYPE=sqlite\` in the env, \`/admin/settings\` shows \`→ sqlite\` next to the dbType env pill.
- [ ] Manual: \`docker run -e DB_TYPE=sqlite -e DB_FILENAME=/data/etherpad.db etherpad/etherpad\`, open /admin/settings, verify dbType pill shows the resolved value and any secret-shaped setting shows the redacted indicator.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Wait + check CI**

Per [[feedback_check_ci_after_pr]]: wait ~20s, then:

```bash
sleep 20 && gh pr checks "$(gh pr view --json number -q .number)"
```

Address any failures immediately before moving on. Per [[feedback_qodo_pr_feedback]]: fetch Qodo's review comments and fix or reply.

---

## Self-Review Notes

- **Spec coverage:** Every section of the spec maps to at least one task (redactor → Task 1+2, emit site → Task 3, backend integration → Task 4, resolveByPath → Task 5, store + selector → Task 6, EnvPill → Tasks 7-9, JsoncNode wiring → Task 10, CSS → Task 11, e2e → Task 12, PR + CI → Task 13). FormView dropdown changes from the spec are intentionally dropped because the current FormView has no enum dropdowns — only the EnvPill (which we are fixing) renders env-substituted strings.
- **No placeholders:** every step has either concrete code or a concrete command. Discovery steps (e.g. "check existing Playwright config") are bounded with a concrete next action.
- **Type consistency:** `resolveByPath` signature is consistent across Task 5/6/10. `redactSettings` signature is consistent across Task 1/2/3/4. `EnvPill.resolvedValue` prop is consistent across Task 8/9/10.
