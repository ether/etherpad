# GDPR PR3 — Anonymous Identity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the anonymous author-token cookie from a client-set, JS-readable cookie to a server-set `HttpOnly; Secure; SameSite=Lax` cookie. Keep legacy `token` in the socket message working for one release.

**Architecture:** A tiny server-side helper `ensureAuthorTokenCookie(req, res)` is called from the `/p/:pad` and `/p/:pad/timeslider` handlers. It mints a `t.<random>` token on first visit, writes it via `res.cookie()` with HttpOnly, and otherwise passes through. `handleClientReady` now reads the token from `socket.request.cookies` first, falling back to `message.token` with a one-time deprecation warn. The browser side drops the client-side token generation and the `token` field in CLIENT_READY.

**Tech Stack:** TypeScript, Express, cookie-parser (already mounted), Playwright for frontend tests, Mocha + supertest for backend tests.

---

## File Structure

**Created by this plan:**
- `src/node/utils/ensureAuthorTokenCookie.ts` — the server-side helper
- `src/tests/backend/specs/authorTokenCookie.ts` — backend integration tests
- `src/tests/frontend-new/specs/author_token_cookie.spec.ts` — Playwright tests

**Modified by this plan:**
- `src/node/hooks/express/specialpages.ts` — call the helper inside the `/p/:pad` and `/p/:pad/timeslider` handlers
- `src/node/handler/PadMessageHandler.ts` — read token from `socket.request.cookies` first, warn on legacy fallback
- `src/static/js/pad.ts` — drop the client-side token read/write; stop sending `token` in CLIENT_READY
- `doc/cookies.md` — flip the `<prefix>token` row to `HttpOnly: true`, note the migration
- `doc/privacy.md` — add one sentence saying Etherpad never falls back to IP for identity

---

## Task 1: `ensureAuthorTokenCookie` helper + unit tests

**Files:**
- Create: `src/node/utils/ensureAuthorTokenCookie.ts`
- Create: `src/tests/backend/specs/ensureAuthorTokenCookie.ts`

- [ ] **Step 1: Write the failing unit test**

```typescript
// src/tests/backend/specs/ensureAuthorTokenCookie.ts
'use strict';

import {strict as assert} from 'assert';
import {ensureAuthorTokenCookie} from '../../../node/utils/ensureAuthorTokenCookie';

type CookieCall = {name: string, value: string, opts: any};
const fakeRes = () => {
  const calls: CookieCall[] = [];
  return {
    calls,
    secure: false,
    cookie(name: string, value: string, opts: any) { calls.push({name, value, opts}); },
  };
};

const cp = 'ep_'; // cookiePrefix
const settingsStub = {cookie: {prefix: cp}} as any;

describe(__filename, function () {
  it('mints a fresh t.* token when the cookie is absent', function () {
    const req: any = {secure: false, cookies: {}, headers: {}};
    const res: any = {secure: false, ...fakeRes()};
    const token = ensureAuthorTokenCookie(req, res, settingsStub);
    assert.ok(typeof token === 'string' && token.startsWith('t.'));
    assert.equal(res.calls.length, 1);
    assert.equal(res.calls[0].name, `${cp}token`);
    assert.equal(res.calls[0].value, token);
    assert.equal(res.calls[0].opts.httpOnly, true);
    assert.equal(res.calls[0].opts.sameSite, 'lax');
    assert.equal(res.calls[0].opts.path, '/');
  });

  it('reuses the cookie value and does not emit Set-Cookie when already set',
      function () {
        const req: any = {
          secure: false,
          cookies: {[`${cp}token`]: 't.abcdefghij1234567890'},
          headers: {},
        };
        const res: any = fakeRes();
        const token = ensureAuthorTokenCookie(req, res, settingsStub);
        assert.equal(token, 't.abcdefghij1234567890');
        assert.equal(res.calls.length, 0);
      });

  it('sets Secure when the request is HTTPS', function () {
    const req: any = {secure: true, cookies: {}, headers: {}};
    const res: any = fakeRes();
    ensureAuthorTokenCookie(req, res, settingsStub);
    assert.equal(res.calls[0].opts.secure, true);
  });

  it('uses SameSite=None when embedded cross-site (Sec-Fetch-Site: cross-site)',
      function () {
        const req: any = {
          secure: true,
          cookies: {},
          headers: {'sec-fetch-site': 'cross-site'},
        };
        const res: any = fakeRes();
        ensureAuthorTokenCookie(req, res, settingsStub);
        assert.equal(res.calls[0].opts.sameSite, 'none');
      });

  it('ignores an invalid existing cookie and mints a fresh one', function () {
    const req: any = {secure: false, cookies: {[`${cp}token`]: 'not-a-token'}, headers: {}};
    const res: any = fakeRes();
    const token = ensureAuthorTokenCookie(req, res, settingsStub);
    assert.ok(token.startsWith('t.'));
    assert.equal(res.calls.length, 1);
    assert.notEqual(res.calls[0].value, 'not-a-token');
  });
});
```

- [ ] **Step 2: Verify the test fails (module not found)**

Run: `pnpm --filter ep_etherpad-lite exec mocha --require tsx/cjs tests/backend/specs/ensureAuthorTokenCookie.ts --timeout 10000`
Expected: module-not-found for `../../../node/utils/ensureAuthorTokenCookie`.

- [ ] **Step 3: Create the helper**

```typescript
// src/node/utils/ensureAuthorTokenCookie.ts
'use strict';

import padutils from '../../static/js/pad_utils';

const isCrossSiteEmbed = (req: any): boolean => {
  const fetchSite = req.headers?.['sec-fetch-site'];
  return fetchSite === 'cross-site';
};

/**
 * Idempotent: if the request already carries a valid author-token cookie,
 * returns its value and does not touch the response. Otherwise mints a fresh
 * `t.<randomString>` token, writes it to the response as an `HttpOnly` cookie,
 * and returns it. Callers must pass the settings object rather than import it
 * here so the helper stays pure and easy to unit test.
 */
export const ensureAuthorTokenCookie = (
  req: any, res: any, settings: {cookie: {prefix?: string}},
): string => {
  const prefix = settings.cookie?.prefix || '';
  const cookieName = `${prefix}token`;
  const existing = req.cookies?.[cookieName];
  if (typeof existing === 'string' && padutils.isValidAuthorToken(existing)) {
    return existing;
  }
  const token = padutils.generateAuthorToken();
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: Boolean(req.secure),
    sameSite: isCrossSiteEmbed(req) ? 'none' : 'lax',
    maxAge: 60 * 24 * 60 * 60 * 1000, // 60 days — matches the pre-PR3 client default
    path: '/',
  });
  return token;
};
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter ep_etherpad-lite exec mocha --require tsx/cjs tests/backend/specs/ensureAuthorTokenCookie.ts --timeout 10000`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/utils/ensureAuthorTokenCookie.ts \
        src/tests/backend/specs/ensureAuthorTokenCookie.ts
git commit -m "feat(gdpr): ensureAuthorTokenCookie helper — HttpOnly server-set author token"
```

---

## Task 2: Wire the helper into the pad and timeslider routes

**Files:**
- Modify: `src/node/hooks/express/specialpages.ts` — call the helper inside both `/p/:pad` handlers

- [ ] **Step 1: Import the helper at the top of `specialpages.ts`**

Find the other `import` lines near the top of the file and add:

```typescript
import {ensureAuthorTokenCookie} from '../../utils/ensureAuthorTokenCookie';
```

- [ ] **Step 2: Call the helper inside the `/p/:pad` `setRouteHandler`**

Locate the `setRouteHandler("/p/:pad", (req, res, next) => { ... })` block (around line 189). Add one line at the top of the handler, before the `isReadOnly` computation:

```typescript
      setRouteHandler("/p/:pad", (req: any, res: any, next: Function) => {
        ensureAuthorTokenCookie(req, res, settings);
        // The below might break for pads being rewritten
        const isReadOnly = !webaccess.userCanModify(req.params.pad, req);
        // ... existing body unchanged ...
      })
```

- [ ] **Step 3: Call the helper in the `/p/:pad/timeslider` handler**

Same treatment (around line 219):

```typescript
      setRouteHandler("/p/:pad/timeslider", (req: any, res: any, next: Function) => {
        ensureAuthorTokenCookie(req, res, settings);
        // ... existing body unchanged ...
      })
```

- [ ] **Step 4: Apply the same two edits to the fallback `args.app.get('/p/:pad', ...)` and `args.app.get('/p/:pad/timeslider', ...)` routes (around lines 350 and 370)**

Read each handler first and insert `ensureAuthorTokenCookie(req, res, settings);` as the first statement in the route callback. These routes are only hit when the live-reload server is not in play; we still want a consistent cookie in production / non-dev mode.

- [ ] **Step 5: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/node/hooks/express/specialpages.ts
git commit -m "feat(gdpr): set HttpOnly author-token cookie from the pad routes"
```

---

## Task 3: Prefer the cookie over `message.token` in `handleClientReady`

**Files:**
- Modify: `src/node/handler/PadMessageHandler.ts` — swap the token resolution order inside `handleClientReady`

- [ ] **Step 1: Find the existing `token` lookup in `handleClientReady`**

Run: `grep -n "message.token\|messageToken" src/node/handler/PadMessageHandler.ts | head`

This locates the line where `token` is read from the message (there is typically a destructure like `const {token, sessionID, …} = message`). Read the surrounding 20 lines to understand the surrounding context.

- [ ] **Step 2: Replace the lookup**

Replace the line(s) that resolve `token` with this block:

```typescript
  const cookiePrefix = settings.cookie?.prefix || '';
  const cookieToken = socket.request?.cookies?.[`${cookiePrefix}token`];
  const legacyToken = typeof message.token === 'string' ? message.token : null;
  const token = cookieToken || legacyToken;
  if (!cookieToken && legacyToken) {
    if (!sessionInfo.legacyTokenWarned) {
      messageLogger.warn(
          'client sent author token via CLIENT_READY message; cookie migration ' +
          'will take effect on next HTTP response. ' +
          'See docs/superpowers/specs/2026-04-19-gdpr-pr3-anon-identity-design.md');
      sessionInfo.legacyTokenWarned = true;
    }
  }
```

The rest of `handleClientReady` continues to use the resolved `token` unchanged.

- [ ] **Step 3: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/node/handler/PadMessageHandler.ts
git commit -m "feat(gdpr): read author token from cookie first, keep message.token fallback"
```

---

## Task 4: Drop the client-side token read/write

**Files:**
- Modify: `src/static/js/pad.ts` — remove the token generation + cookie-set block, stop sending `token`

- [ ] **Step 1: Read the relevant block**

Lines 190-195 of `src/static/js/pad.ts` currently do:

```typescript
  const cp = (window as any).clientVars?.cookiePrefix || '';
  let token = Cookies.get(`${cp}token`) || Cookies.get('token');
  if (token == null || !padutils.isValidAuthorToken(token)) {
    token = padutils.generateAuthorToken();
    Cookies.set(`${cp}token`, token, {expires: 60});
  }
```

- [ ] **Step 2: Remove those lines and drop the `token` field from the CLIENT_READY message**

Replace the block with a single comment, and remove `token` from the message literal that follows (line ~212):

```typescript
  // Author token lives in an HttpOnly cookie set by the server (#6701 PR3).
  // The browser never reads or writes it; the server reads the cookie off
  // the socket.io handshake request in handleClientReady.
```

Also, just below, in the `msg` literal, remove the `token,` line so the shorthand property goes away.

- [ ] **Step 3: Remove the now-unused `token` local from the reconnect path**

If the reconnect branch below the `msg` literal reads the local `token`, either inline the `undefined` or clean up the reference. Read lines 215-225 first — they may or may not need changes.

- [ ] **Step 4: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/static/js/pad.ts
git commit -m "feat(gdpr): stop generating the author token client-side"
```

---

## Task 5: Backend integration tests — cookie lifecycle

**Files:**
- Create: `src/tests/backend/specs/authorTokenCookie.ts`

- [ ] **Step 1: Write the integration test**

```typescript
'use strict';

import {strict as assert} from 'assert';

const common = require('../common');
const setCookieParser = require('set-cookie-parser');

describe(__filename, function () {
  let agent: any;

  before(async function () {
    this.timeout(60000);
    agent = await common.init();
  });

  const padPath = () => `/p/PR3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  it('sets an HttpOnly token cookie on first visit', async function () {
    const res = await agent.get(padPath()).expect(200);
    const cookies = setCookieParser.parse(res, {map: true});
    const tokenCookie = Object.entries(cookies).find(([k]) => k.endsWith('token'))?.[1] as any;
    assert.ok(tokenCookie, `expected a token cookie in ${Object.keys(cookies).join(',')}`);
    assert.match(tokenCookie.value, /^t\./);
    assert.equal(tokenCookie.httpOnly, true);
    assert.equal(String(tokenCookie.sameSite || '').toLowerCase(), 'lax');
    assert.equal(tokenCookie.path, '/');
  });

  it('reuses the cookie value on subsequent visits', async function () {
    const path = padPath();
    const first = await agent.get(path).expect(200);
    const firstCookies = setCookieParser.parse(first, {map: true});
    const firstToken = Object.entries(firstCookies).find(([k]) => k.endsWith('token'))?.[1] as any;
    assert.ok(firstToken);

    const second = await agent.get(path)
        .set('Cookie', `${Object.keys(firstCookies)[0]}=${firstToken.value}`)
        .expect(200);
    const secondCookies = setCookieParser.parse(second, {map: true});
    const resentName = Object.keys(secondCookies).find((k) => k.endsWith('token'));
    assert.equal(resentName, undefined,
        `server should not re-send the token cookie when one is already present`);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter ep_etherpad-lite exec mocha --require tsx/cjs tests/backend/specs/authorTokenCookie.ts --timeout 30000`
Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tests/backend/specs/authorTokenCookie.ts
git commit -m "test(gdpr): server sets + reuses the HttpOnly author-token cookie"
```

---

## Task 6: Playwright — identity persists across reload, not across contexts

**Files:**
- Create: `src/tests/frontend-new/specs/author_token_cookie.spec.ts`

- [ ] **Step 1: Write the Playwright spec**

```typescript
import {expect, test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {goToNewPad} from '../helper/padHelper';

test.describe('author token cookie', () => {
  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  test('author token cookie is HttpOnly and not readable via document.cookie',
      async ({page, context}) => {
        await goToNewPad(page);

        const cookies = await context.cookies();
        const tokenCookie = cookies.find((c) => c.name.endsWith('token'));
        expect(tokenCookie, `cookies: ${JSON.stringify(cookies.map((c) => c.name))}`)
            .toBeDefined();
        expect(tokenCookie!.httpOnly).toBe(true);
        expect(tokenCookie!.sameSite.toLowerCase()).toBe('lax');

        const jsVisible = await page.evaluate(() => document.cookie);
        expect(jsVisible).not.toContain(tokenCookie!.name);
      });

  test('authorID is stable across reload in the same context', async ({page}) => {
    await goToNewPad(page);
    const first = await page.evaluate(() => (window as any).clientVars?.userId);
    await page.reload();
    await page.waitForSelector('#editorcontainer.initialized');
    const second = await page.evaluate(() => (window as any).clientVars?.userId);
    expect(second).toBe(first);
  });

  test('authorID differs in an isolated second context', async ({page, browser}) => {
    const padId = await goToNewPad(page);
    const first = await page.evaluate(() => (window as any).clientVars?.userId);

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(`http://localhost:9001/p/${padId}`);
    await page2.waitForSelector('#editorcontainer.initialized');
    const second = await page2.evaluate(() => (window as any).clientVars?.userId);
    expect(second).not.toBe(first);
    await context2.close();
  });
});
```

- [ ] **Step 2: Restart the test server so it picks up the Task 1–4 code**

```bash
lsof -iTCP:9001 -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2}' | xargs -r kill 2>&1; sleep 2
(cd src && NODE_ENV=production node --require tsx/cjs node/server.ts -- \
    --settings tests/settings.json > /tmp/etherpad-test.log 2>&1 &)
sleep 10
lsof -iTCP:9001 -sTCP:LISTEN 2>/dev/null | tail -2
```

Expected: port 9001 listening.

- [ ] **Step 3: Run the Playwright spec**

```bash
cd src && NODE_ENV=production npx playwright test author_token_cookie --project=chromium
```

Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/tests/frontend-new/specs/author_token_cookie.spec.ts
git commit -m "test(gdpr): Playwright coverage for the HttpOnly author-token cookie"
```

---

## Task 7: Docs

**Files:**
- Modify: `doc/cookies.md` — update the `<prefix>token` row to `HttpOnly: true`, note the server-side set
- Modify: `doc/privacy.md` — add one sentence clarifying Etherpad does not fall back to IP for identity

- [ ] **Step 1: Read `doc/cookies.md` and find the token row**

Run: `grep -n "token" doc/cookies.md`

Locate the row describing the author token (likely the one that mentions `60 days` or `pad_utils`). Replace the `Http-only` column value (currently `false`) with `true`, and update the description to read: *Set by the server as an HttpOnly cookie on the first pad GET (`/p/:pad`). The server reads it from the socket.io handshake to resolve the author. See [privacy.md](privacy.md).*

- [ ] **Step 2: Add the identity-fallback sentence to `doc/privacy.md`**

Append to the existing "What Etherpad does not do" bullet list in `doc/privacy.md` (shipped in PR2):

```markdown
- IP addresses are never used as an identity fallback. The anonymous
  author identity is carried by an HttpOnly `<prefix>token` cookie
  issued by the server on first pad visit; see
  [cookies.md](cookies.md).
```

- [ ] **Step 3: Commit**

```bash
git add doc/cookies.md doc/privacy.md
git commit -m "docs(gdpr): flip token cookie to HttpOnly + no-IP-identity note"
```

---

## Task 8: End-to-end verification, push, open PR

**Files:** (no edits)

- [ ] **Step 1: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 2: Backend + frontend sweep**

```bash
pnpm --filter ep_etherpad-lite exec mocha --require tsx/cjs \
  tests/backend/specs/ensureAuthorTokenCookie.ts \
  tests/backend/specs/authorTokenCookie.ts --timeout 30000

cd src && NODE_ENV=production npx playwright test \
  author_token_cookie chat.spec enter.spec --project=chromium
```

Expected: all tests pass.

- [ ] **Step 3: Push and open the PR**

```bash
git push origin feat-gdpr-anon-identity
gh pr create --repo ether/etherpad --base develop --head feat-gdpr-anon-identity \
  --title "feat(gdpr): HttpOnly author-token cookie (PR3 of #6701)" --body "$(cat <<'EOF'
## Summary
- Author-token cookie is now minted and set by the server on the pad route as `HttpOnly; Secure (on HTTPS); SameSite=Lax` (or `None` when cross-site embedded).
- Browser JavaScript no longer reads, writes, or sends the token.
- `handleClientReady` reads the token from the socket.io handshake cookies; legacy `message.token` field is honoured for one release with a one-time WARN.
- No IP-based identity fallback (documented in `privacy.md`).

Part of the GDPR work tracked in #6701. PR1 (#7546) landed deletion controls; PR2 (#7547) landed the IP-logging audit. Remaining PR4 (cookie banner) and PR5 (author erasure) stay in follow-ups.

Design spec: `docs/superpowers/specs/2026-04-19-gdpr-pr3-anon-identity-design.md`
Implementation plan: `docs/superpowers/plans/2026-04-19-gdpr-pr3-anon-identity.md`

## Test plan
- [x] ts-check clean
- [x] ensureAuthorTokenCookie unit tests (5 cases)
- [x] authorTokenCookie integration tests (set-once + reuse)
- [x] Playwright (HttpOnly attribute, cross-reload stability, context isolation)
EOF
)"
```

- [ ] **Step 4: Monitor CI**

Run: `gh pr checks <PR-number> --repo ether/etherpad`

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
| --- | --- |
| Server mints + sets HttpOnly cookie | 1, 2 |
| Cookie attributes (HttpOnly/Secure/SameSite/maxAge/path) | 1 |
| Socket handshake reads cookie; falls back to `message.token` with WARN | 3 |
| Client stops generating the token | 4 |
| IP-fallback documentation | 7 |
| Backend integration tests | 5 |
| Frontend tests (HttpOnly, stability, isolation) | 6 |
| `doc/cookies.md` flip + `doc/privacy.md` sentence | 7 |

All spec sections have a task.

**Placeholders:** none — every code block is complete.

**Type consistency:**
- `ensureAuthorTokenCookie(req, res, settings)` signature identical in Tasks 1, 2, 5.
- `t.<randomString>` token format consistent across Tasks 1 (mint), 3 (resolution), 5 (regex assertion `/^t\./`).
- `sessionInfo.legacyTokenWarned` flag used only inside Task 3.
- `message.token` field touched in Tasks 3 (server read) and 4 (client drop); types stay in sync because no type file declares the client-outgoing `token` field separately.
