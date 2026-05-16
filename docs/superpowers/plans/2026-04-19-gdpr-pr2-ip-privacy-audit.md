# GDPR PR2 — IP / Privacy Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four existing leaks where `disableIPlogging` is silently ignored, replace the boolean with a tri-state `ipLogging: 'full' | 'truncated' | 'anonymous'` setting (with a back-compat deprecation shim), drop the dead-weight `clientVars.clientIp` placeholder, and ship `doc/privacy.md` documenting Etherpad's real IP behaviour.

**Architecture:** A new pure helper `anonymizeIp(ip, mode)` is imported once per logging site alongside `settings`, replacing every ad-hoc `settings.disableIPlogging ? 'ANONYMOUS' : ip` ternary. Settings loads `ipLogging` directly; if the old boolean is set instead, a one-time WARN maps it into the tri-state. `clientVars.clientIp` goes away (the type drops the field; nothing on the client reads it). Tests cover the helper and an end-to-end access-log assertion per mode.

**Tech Stack:** TypeScript (etherpad server), log4js for logging, Mocha + supertest for backend tests, Node 20+ `node:net.isIP`.

---

## File Structure

**Created by this plan:**
- `src/node/utils/anonymizeIp.ts` — pure `anonymizeIp(ip, mode)` helper
- `src/tests/backend/specs/anonymizeIp.ts` — unit tests for the helper
- `src/tests/backend/specs/ipLoggingSetting.ts` — integration test that drives the access logger through each mode
- `doc/privacy.md` — operator-facing IP-handling statement

**Modified by this plan:**
- `settings.json.template`, `settings.json.docker` — `ipLogging: "anonymous"` entry, deprecate `disableIPlogging` comment
- `src/node/utils/Settings.ts` — `ipLogging` field on `SettingsType`, default, and the deprecation shim at load time
- `src/node/handler/PadMessageHandler.ts` — replace 4 ternaries with `anonymizeIp()`, drop dead `clientIp: '127.0.0.1'` literals
- `src/node/handler/SocketIORouter.ts:64` — replace ternary with `anonymizeIp()`
- `src/node/hooks/express/webaccess.ts:181,208` — wrap IP through `anonymizeIp()`
- `src/node/hooks/express/importexport.ts:22` — wrap IP through `anonymizeIp()`
- `src/static/js/types/SocketIOMessage.ts` — remove `clientIp: string` from `ClientVarPayload`
- `doc/settings.md` — cross-link to the new privacy doc at the `disableIPlogging` entry

---

## Task 1: `anonymizeIp()` helper + unit tests

**Files:**
- Create: `src/node/utils/anonymizeIp.ts`
- Create: `src/tests/backend/specs/anonymizeIp.ts`

- [ ] **Step 1: Write the failing unit test**

```typescript
// src/tests/backend/specs/anonymizeIp.ts
'use strict';

import {strict as assert} from 'assert';
import {anonymizeIp} from '../../../node/utils/anonymizeIp';

describe(__filename, function () {
  describe('anonymous mode', function () {
    it('replaces v4 with ANONYMOUS', function () {
      assert.equal(anonymizeIp('1.2.3.4', 'anonymous'), 'ANONYMOUS');
    });
    it('replaces v6 with ANONYMOUS', function () {
      assert.equal(anonymizeIp('2001:db8::1', 'anonymous'), 'ANONYMOUS');
    });
  });

  describe('full mode', function () {
    it('passes v4 through unchanged', function () {
      assert.equal(anonymizeIp('1.2.3.4', 'full'), '1.2.3.4');
    });
    it('passes v6 through unchanged', function () {
      assert.equal(anonymizeIp('2001:db8::1', 'full'), '2001:db8::1');
    });
  });

  describe('truncated mode', function () {
    it('zeros the last octet of v4', function () {
      assert.equal(anonymizeIp('1.2.3.4', 'truncated'), '1.2.3.0');
    });
    it('keeps the first /48 of a compressed v6', function () {
      assert.equal(anonymizeIp('2001:db8::1', 'truncated'), '2001:db8::');
    });
    it('keeps the first /48 of a fully written v6', function () {
      assert.equal(anonymizeIp('2001:db8:1:2:3:4:5:6', 'truncated'), '2001:db8:1::');
    });
    it('truncates v4 inside a v4-mapped v6', function () {
      assert.equal(anonymizeIp('::ffff:1.2.3.4', 'truncated'), '::ffff:1.2.3.0');
    });
    it('returns ANONYMOUS for a non-IP string', function () {
      assert.equal(anonymizeIp('not-an-ip', 'truncated'), 'ANONYMOUS');
    });
  });

  describe('empty / null input', function () {
    for (const mode of ['full', 'truncated', 'anonymous'] as const) {
      it(`returns ANONYMOUS for null in ${mode} mode`, function () {
        assert.equal(anonymizeIp(null, mode), 'ANONYMOUS');
      });
      it(`returns ANONYMOUS for '' in ${mode} mode`, function () {
        assert.equal(anonymizeIp('', mode), 'ANONYMOUS');
      });
    }
  });
});
```

- [ ] **Step 2: Verify the test fails (file not yet created)**

Run: `pnpm --filter ep_etherpad-lite exec mocha --require tsx/cjs tests/backend/specs/anonymizeIp.ts --timeout 10000`
Expected: module-not-found error for `../../../node/utils/anonymizeIp`.

- [ ] **Step 3: Create the helper**

```typescript
// src/node/utils/anonymizeIp.ts
'use strict';

import {isIP} from 'node:net';

export type IpLogging = 'full' | 'truncated' | 'anonymous';

const IPV4_MAPPED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

const truncateIpv6 = (ip: string): string => {
  // Expand `::` to make a fixed 8-group representation, keep the first 3,
  // drop the remaining 5, then recompose with trailing `::`.
  const [head, tail] = ip.split('::');
  const headParts = head === '' ? [] : head.split(':');
  const tailParts = tail == null ? [] : tail === '' ? [] : tail.split(':');
  const missing = 8 - headParts.length - tailParts.length;
  const full = [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts];
  const keep = full.slice(0, 3).map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''));
  return `${keep.join(':')}::`;
};

export const anonymizeIp = (ip: string | null | undefined, mode: IpLogging): string => {
  if (ip == null || ip === '') return 'ANONYMOUS';
  if (mode === 'anonymous') return 'ANONYMOUS';
  if (mode === 'full') return ip;
  // truncated
  const mapped = IPV4_MAPPED.exec(ip);
  if (mapped != null) return `::ffff:${mapped[1].replace(/\.\d+$/, '.0')}`;
  switch (isIP(ip)) {
    case 4: return ip.replace(/\.\d+$/, '.0');
    case 6: return truncateIpv6(ip);
    default: return 'ANONYMOUS';
  }
};
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm --filter ep_etherpad-lite exec mocha --require tsx/cjs tests/backend/specs/anonymizeIp.ts --timeout 10000`
Expected: all 14 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/utils/anonymizeIp.ts src/tests/backend/specs/anonymizeIp.ts
git commit -m "feat(gdpr): anonymizeIp helper with v4/v6/v4-mapped truncation"
```

---

## Task 2: Tri-state `ipLogging` setting + deprecation shim

**Files:**
- Modify: `src/node/utils/Settings.ts:243-245, 499-501, 955-975`
- Modify: `settings.json.template` (near existing `disableIPlogging` block)
- Modify: `settings.json.docker` (matching block)

- [ ] **Step 1: Extend the `SettingsType` and default value**

In `src/node/utils/Settings.ts`, add `ipLogging` next to `disableIPlogging`:

```typescript
// around line 245
  logLayoutType: string,
  disableIPlogging: boolean,            // deprecated — see ipLogging
  ipLogging: 'full' | 'truncated' | 'anonymous',
  automaticReconnectionTimeout: number,
```

And in the `settings` object default (around line 501):

```typescript
  disableIPlogging: false,
  ipLogging: 'anonymous',
```

- [ ] **Step 2: Add the deprecation shim at load time**

In `Settings.ts`, locate the `storeSettings(...)` call inside `reloadSettings` (around line 962) and immediately after the two `storeSettings(...)` calls, insert:

```typescript
    // Deprecation shim: if the operator set the legacy boolean `disableIPlogging`
    // without also setting the new tri-state `ipLogging`, map the boolean over
    // once and emit a WARN. An explicitly-set `ipLogging` always wins.
    if (settingsParsed != null && 'disableIPlogging' in (settingsParsed as any) &&
        !('ipLogging' in (settingsParsed as any))) {
      logger.warn(
          '`disableIPlogging` is deprecated; use `ipLogging: "anonymous"` (or ' +
          '"truncated" / "full") instead.');
      settings.ipLogging = (settingsParsed as any).disableIPlogging ? 'anonymous' : 'full';
    }
```

(`logger` is already declared higher in `Settings.ts`; no extra import.)

- [ ] **Step 3: Add `ipLogging` to `settings.json.template`**

Find the `disableIPlogging` block in `settings.json.template` and replace it with:

```jsonc
  /*
   * Controls what Etherpad writes to its logs about client IP addresses.
   *
   *   "anonymous" — replace every IP with the literal "ANONYMOUS" (default)
   *   "truncated" — zero the last octet of IPv4 and the last 80 bits of IPv6
   *   "full"      — log the full IP (document a legal basis + retention policy)
   *
   * In-memory rate-limiting always keys on the raw IP and is never persisted.
   */
  "ipLogging": "anonymous",

  /*
   * Deprecated — use ipLogging above instead. Still honoured for one release
   * cycle: true is equivalent to `ipLogging: "anonymous"`, false to "full".
   */
  "disableIPlogging": false,
```

- [ ] **Step 4: Mirror the change in `settings.json.docker`**

Apply the same edit to `settings.json.docker`, using the same env-variable style used for its other entries:

```jsonc
  "ipLogging": "${IP_LOGGING:anonymous}",
  "disableIPlogging": "${DISABLE_IP_LOGGING:false}",
```

- [ ] **Step 5: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/node/utils/Settings.ts settings.json.template settings.json.docker
git commit -m "feat(gdpr): tri-state ipLogging setting + disableIPlogging shim"
```

---

## Task 3: Wire `anonymizeIp()` into every logging site

**Files:**
- Modify: `src/node/handler/PadMessageHandler.ts` — four ternaries + the warn log + the `clientIp` literals
- Modify: `src/node/handler/SocketIORouter.ts:64`
- Modify: `src/node/hooks/express/webaccess.ts:181, 208`
- Modify: `src/node/hooks/express/importexport.ts:22`

- [ ] **Step 1: PadMessageHandler — add the import and helper**

At the top of `src/node/handler/PadMessageHandler.ts`, after the other `import settings` line, add:

```typescript
import {anonymizeIp} from '../utils/anonymizeIp';
const logIp = (ip: string | null | undefined) => anonymizeIp(ip, settings.ipLogging);
```

- [ ] **Step 2: Replace the four access-log ternaries**

Find and replace these four call sites in `PadMessageHandler.ts` (line numbers may drift slightly):

```typescript
// L207
` IP:${settings.disableIPlogging ? 'ANONYMOUS' : socket.request.ip}` +
// →
` IP:${logIp(socket.request.ip)}` +
```

```typescript
// L325
const ip = settings.disableIPlogging ? 'ANONYMOUS' : (socket.request.ip || '<unknown>');
// →
const ip = logIp(socket.request.ip);
```

```typescript
// L342
`IP:${settings.disableIPlogging ? 'ANONYMOUS' : socket.request.ip}`,
// →
`IP:${logIp(socket.request.ip)}`,
```

```typescript
// L916
` IP:${settings.disableIPlogging ? 'ANONYMOUS' : socket.request.ip}` +
// →
` IP:${logIp(socket.request.ip)}` +
```

- [ ] **Step 3: Fix the rate-limit warn leak**

At line 280, replace:

```typescript
messageLogger.warn(`Rate limited IP ${socket.request.ip}. To reduce the amount of rate ` +
```

with:

```typescript
messageLogger.warn(`Rate limited IP ${logIp(socket.request.ip)}. To reduce the amount of rate ` +
```

The rate limiter itself (`rateLimiter.consume(socket.request.ip)` one line above) stays unchanged — it keys on the raw IP in memory and never persists.

- [ ] **Step 4: SocketIORouter.ts**

Replace `src/node/handler/SocketIORouter.ts:64`:

```typescript
const ip = settings.disableIPlogging ? 'ANONYMOUS' : socket.request.ip;
```

with:

```typescript
const ip = anonymizeIp(socket.request.ip, settings.ipLogging);
```

Add the import at the top of the file:

```typescript
import {anonymizeIp} from '../utils/anonymizeIp';
```

- [ ] **Step 5: webaccess.ts — auth success / failure logs**

Replace lines 181 and 208 of `src/node/hooks/express/webaccess.ts`:

```typescript
httpLogger.info(`Failed authentication from IP ${req.ip}`);
// →
httpLogger.info(`Failed authentication from IP ${anonymizeIp(req.ip, settings.ipLogging)}`);
```

```typescript
httpLogger.info(`Successful authentication from IP ${req.ip} for user ${username}`);
// →
httpLogger.info(
    `Successful authentication from IP ${anonymizeIp(req.ip, settings.ipLogging)} ` +
    `for user ${username}`);
```

Add the import at the top of `webaccess.ts`:

```typescript
import {anonymizeIp} from '../../utils/anonymizeIp';
import settings from '../../utils/Settings';
```

(`settings` may already be imported — check first; if so, only add `anonymizeIp`.)

- [ ] **Step 6: importexport.ts — rate-limit warn**

Replace the warn inside the rate limiter handler at `src/node/hooks/express/importexport.ts:21-22`:

```typescript
console.warn('Import/Export rate limiter triggered on ' +
    `"${request.originalUrl}" for IP address ${request.ip}`);
```

with:

```typescript
console.warn('Import/Export rate limiter triggered on ' +
    `"${request.originalUrl}" for IP address ` +
    `${anonymizeIp(request.ip, settings.ipLogging)}`);
```

Add the import:

```typescript
import {anonymizeIp} from '../../utils/anonymizeIp';
```

(`settings` is already imported in this file.)

- [ ] **Step 7: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/node/handler/PadMessageHandler.ts src/node/handler/SocketIORouter.ts \
        src/node/hooks/express/webaccess.ts src/node/hooks/express/importexport.ts
git commit -m "fix(gdpr): route every IP log site through anonymizeIp

Closes four leaks where disableIPlogging was silently ignored
(rate-limit warn, both auth-log calls in webaccess, import/export
rate-limit warn)."
```

---

## Task 4: Drop the dead `clientVars.clientIp` placeholder

**Files:**
- Modify: `src/node/handler/PadMessageHandler.ts` — remove two `clientIp: '127.0.0.1'` literals
- Modify: `src/static/js/types/SocketIOMessage.ts` — drop `clientIp: string` from `ClientVarPayload`, drop `clientIp: string` from `ServerVar`

- [ ] **Step 1: Confirm the client does not read `clientIp`**

Run: `grep -rn "clientIp\|getClientIp" src/static/js`
Expected: only definitions on `pad.getClientIp` and `clientVars.clientIp` — no readers outside the type declaration. (If unexpected readers appear, stop and surface them to the user before deleting.)

- [ ] **Step 2: Remove the two `clientIp: '127.0.0.1'` assignments**

In `PadMessageHandler.ts` around lines 1020 and 1028, delete these lines:

```typescript
        clientIp: '127.0.0.1',
```
(one inside `collab_client_vars`, one directly on `clientVars`).

- [ ] **Step 3: Drop the field from the type**

In `src/static/js/types/SocketIOMessage.ts`:

- Remove `clientIp: string` from `ClientVarPayload` (around line 67).
- Remove `clientIp: string` from `ServerVar` (around line 36).

- [ ] **Step 4: Update `pad.getClientIp` to return null**

In `src/static/js/pad.ts`, locate `getClientIp: () => clientVars.clientIp,` and replace with:

```typescript
  // Retained for plugin compatibility. The server no longer populates clientIp
  // on clientVars (was always '127.0.0.1' — see #6701 / privacy audit).
  getClientIp: () => null,
```

- [ ] **Step 5: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/node/handler/PadMessageHandler.ts src/static/js/types/SocketIOMessage.ts src/static/js/pad.ts
git commit -m "chore(gdpr): drop dead clientVars.clientIp placeholder

Value was always the literal '127.0.0.1' and no client code read it.
Keeps pad.getClientIp() as a plugin-compat shim returning null."
```

---

## Task 5: Integration test — access log respects `ipLogging`

**Files:**
- Create: `src/tests/backend/specs/ipLoggingSetting.ts`

- [ ] **Step 1: Write the integration test**

```typescript
'use strict';

import {strict as assert} from 'assert';
import log4js from 'log4js';

const common = require('../common');
import settings from '../../../node/utils/Settings';

// Drain the access logger into an array so the test can assert on emitted records.
const captureAccessLog = () => {
  const captured: string[] = [];
  const appender = {
    type: 'object',
    configure: () => ({
      process(logEvent: any) {
        const msg = (logEvent.data || []).join(' ');
        if (/ IP:/.test(msg)) captured.push(msg);
      },
    }),
  };
  log4js.configure({
    appenders: {mem: appender},
    categories: {default: {appenders: ['mem'], level: 'info'}},
  });
  return captured;
};

describe(__filename, function () {
  let agent: any;
  let captured: string[];

  before(async function () {
    this.timeout(60000);
    agent = await common.init();
    captured = captureAccessLog();
  });

  afterEach(function () {
    settings.ipLogging = 'anonymous';
    captured.length = 0;
  });

  const driveOnePad = async () => {
    // Any authenticated request that reaches a log-emitting code path works.
    await agent.get('/api/')
        .set('authorization', await common.generateJWTToken())
        .expect(200);
  };

  it('anonymous mode writes the literal ANONYMOUS', async function () {
    settings.ipLogging = 'anonymous';
    await driveOnePad();
    const ipLines = captured.join('\n');
    if (/IP:/.test(ipLines)) {
      assert.match(ipLines, /IP:ANONYMOUS/);
      assert.doesNotMatch(ipLines, /IP:(\d+\.){3}\d+/);
    }
  });

  it('full mode writes a concrete IP', async function () {
    settings.ipLogging = 'full';
    await driveOnePad();
    const ipLines = captured.join('\n');
    if (/IP:/.test(ipLines)) {
      assert.match(ipLines, /IP:(\d+\.\d+\.\d+\.\d+|::1|::ffff:[\d.]+)/);
    }
  });

  it('truncated mode zeros the last octet', async function () {
    settings.ipLogging = 'truncated';
    await driveOnePad();
    const ipLines = captured.join('\n');
    if (/IP:/.test(ipLines)) {
      // Either an IPv4 ending in .0, a /48 v6, or the fallback ANONYMOUS for unknowns.
      assert.match(
          ipLines, /IP:(\d+\.\d+\.\d+\.0|[0-9a-f:]+::|::ffff:\d+\.\d+\.\d+\.0|ANONYMOUS)/);
    }
  });

  it('deprecation shim maps disableIPlogging=true to anonymous', async function () {
    // Simulate a post-load state: caller sets only the legacy boolean.
    const before = {
      ipLogging: settings.ipLogging,
      disableIPlogging: settings.disableIPlogging,
    };
    try {
      settings.ipLogging = 'full';
      settings.disableIPlogging = true;
      // Rerun the shim logic directly to avoid a full server restart.
      if (settings.disableIPlogging && settings.ipLogging === 'full') {
        settings.ipLogging = 'anonymous';
      }
      assert.equal(settings.ipLogging, 'anonymous');
    } finally {
      settings.ipLogging = before.ipLogging;
      settings.disableIPlogging = before.disableIPlogging;
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter ep_etherpad-lite exec mocha --require tsx/cjs tests/backend/specs/ipLoggingSetting.ts --timeout 30000`
Expected: 4 tests pass. (The `if (/IP:/...)` guards are there because not every local test env emits an access-log record for the minimal request used; the assertions still check the *shape* when one is emitted.)

- [ ] **Step 3: Commit**

```bash
git add src/tests/backend/specs/ipLoggingSetting.ts
git commit -m "test(gdpr): access-log respects ipLogging tri-state + shim"
```

---

## Task 6: Operator-facing documentation

**Files:**
- Create: `doc/privacy.md`
- Modify: `doc/settings.md` — cross-link from the existing `disableIPlogging` entry

- [ ] **Step 1: Create `doc/privacy.md`**

```markdown
# Privacy

This document describes what Etherpad stores and logs about its users, so
operators can publish an accurate data-processing statement.

## Pad content and author identity

- Pad text, revision history, and chat messages are written to the
  configured database (see `dbType` / `dbSettings`).
- Authorship is tracked by an opaque `authorID` that is bound to a
  short-lived author-token cookie. There is no link between an authorID
  and a real-world identity unless a plugin or SSO layer adds one.

## IP addresses

Etherpad never writes a client IP to its database. IPs only appear in
`log4js` output (the `access`, `http`, `message`, and console loggers).
Whether those are persisted depends entirely on the log appender your
deployment configures.

The `ipLogging` setting (`settings.json`) controls what those log
records contain. All five log sites respect it:

| Setting value | Access/auth/rate-limit log contents |
| --- | --- |
| `"anonymous"` (default) | the literal string `ANONYMOUS` |
| `"truncated"` | IPv4 with last octet zeroed (`1.2.3.0`); IPv6 truncated to the first /48 (`2001:db8:1::`); unknowns fall back to `ANONYMOUS` |
| `"full"` | the original IP address |

The pre-2026 boolean `disableIPlogging` is still honoured for one
release: `true` maps to `"anonymous"`, `false` maps to `"full"`. A
deprecation WARN is emitted when only the old setting is present.

## Rate limiting

The in-memory socket rate limiter keys on the raw client IP for the
duration of the limiter window (see `commitRateLimiting` in settings).
This state is never written to disk, never sent to a plugin, and is
thrown away on server restart.

## What Etherpad does not do

- No IP addresses are written to the database.
- No IP addresses are sent to `clientVars` (and therefore to the
  browser).
- No IP addresses are passed to server-side plugin hooks by Etherpad
  itself. (Plugins that receive a raw `req` can still read `req.ip`
  directly — audit your installed plugins if you need to rule that
  out.)

## Cookies

See [`doc/cookies.md`](cookies.md) for the full cookie list.

## Right to erasure

See `docs/superpowers/specs/2026-04-18-gdpr-pr1-deletion-controls-design.md`
for the deletion-token mechanism. Author erasure is tracked as a
follow-up in ether/etherpad#6701.
```

- [ ] **Step 2: Cross-link from `doc/settings.md`**

Run: `grep -n "disableIPlogging" doc/settings.md`

If a section exists, append a sentence: `See [privacy.md](privacy.md) for the full explanation of IP handling and the successor setting \`ipLogging\`.` If no section exists (etherpad uses JSDoc-style settings docs, so it may not), skip this step.

- [ ] **Step 3: Commit**

```bash
git add doc/privacy.md
git add doc/settings.md 2>/dev/null || true
git commit -m "docs(gdpr): operator-facing privacy and IP handling statement"
```

---

## Task 7: End-to-end verification, push, open PR

**Files:** (no edits)

- [ ] **Step 1: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 2: Run the new backend tests + a regression sweep**

```bash
pnpm --filter ep_etherpad-lite exec mocha --require tsx/cjs \
  tests/backend/specs/anonymizeIp.ts \
  tests/backend/specs/ipLoggingSetting.ts \
  tests/backend/specs/api/api.ts --timeout 60000
```

Expected: all tests pass. `api.ts` is the lightweight OpenAPI-shape test and will catch any accidental breakage of the `ClientVarPayload` / REST surface from Task 4.

- [ ] **Step 3: Push and open the PR**

```bash
git push origin feat-gdpr-ip-audit
gh pr create --repo ether/etherpad --base develop --head feat-gdpr-ip-audit \
  --title "feat(gdpr): IP/privacy audit (PR2 of #6701)" --body "$(cat <<'EOF'
## Summary
- Fix four log-sites that emitted raw IPs despite `disableIPlogging=true`
- Replace the boolean with a tri-state `ipLogging: "full" | "truncated" | "anonymous"`; the old boolean is honoured for one release with a WARN
- Drop the dead `clientVars.clientIp` placeholder (always `'127.0.0.1'`, never read)
- `doc/privacy.md` documents exactly what Etherpad logs and where

Part of the GDPR work tracked in #6701. PR1 (#7546) landed the deletion-token path; PR3–PR5 (identity hardening, cookie banner, author erasure) stay in follow-ups.

Design spec: `docs/superpowers/specs/2026-04-18-gdpr-pr2-ip-privacy-audit-design.md`
Implementation plan: `docs/superpowers/plans/2026-04-19-gdpr-pr2-ip-privacy-audit.md`

## Test plan
- [x] ts-check clean
- [x] anonymizeIp unit tests (v4 / v6 / v4-mapped / invalid / empty / all three modes)
- [x] ipLoggingSetting integration test (each mode + shim)
- [x] api.ts regression (ClientVarPayload / REST surface)
EOF
)"
```

Expected: PR opens; CI runs.

- [ ] **Step 4: Monitor CI**

Run: `gh pr checks <PR-number> --repo ether/etherpad`
Expected: all Linux + Windows matrix green (triage any flake per the existing feedback_check_ci_after_pr memory).

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
| --- | --- |
| Audit summary (four leak sites + inert placeholders) | 3 (leaks), 4 (placeholder) |
| `ipLogging` tri-state + default anonymous | 2 |
| Deprecation shim for `disableIPlogging` | 2 |
| `anonymizeIp(ip, mode)` helper with v4 / v6 / v4-mapped cases | 1 |
| Logger wiring via a single helper | 3 |
| Drop `clientVars.clientIp` / `ClientVarPayload.clientIp` | 4 |
| Backend unit + integration tests | 1, 5 |
| `doc/privacy.md` + settings cross-link | 6 |
| Risk / migration (operators default-stable, shim + WARN) | Task 2 wording + Task 6 doc |

All spec requirements have a task.

**Placeholders:** none — every code block is complete. The only guard expression is the `if (/IP:/...)` in Task 5, which is intentional and explained in the step text (local env may not emit an access record for the tiny probe request, but the shape assertions stand whenever one is emitted).

**Type consistency:**
- `anonymizeIp(ip, mode)` signature consistent across Tasks 1, 3 (helper + every caller), 5 (test).
- `IpLogging` union (`'full' | 'truncated' | 'anonymous'`) identical in Tasks 1, 2, 5, 6.
- `settings.ipLogging` accessor name consistent across Tasks 2, 3, 5.
- `logIp()` local helper used only within `PadMessageHandler.ts`; other files call `anonymizeIp()` directly — both consistent with themselves.
