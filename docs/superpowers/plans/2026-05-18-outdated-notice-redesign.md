# Outdated-Version Notice Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the persistent, all-visitor "severely outdated" banner with a dismissable gritter shown only to a pad's first author when the running server is at least one minor version behind the latest published release; drop the `vulnerable-below` UI entirely.

**Architecture:** Server-gated. `/api/version-status` becomes pad-aware (takes `?padId=<id>`), resolves the requesting browser's authorID via the express session, returns `{outdated:'minor'|null, isFirstAuthor:boolean}` only after confirming pool-position-0 match. Client invokes the check once `clientVars` is populated and calls `$.gritter.add(...)` only on a positive answer. No localStorage. Dev-build suppression follows from `current >= latest`.

**Tech Stack:** TypeScript, Express, vitest (backend), Playwright (frontend), `lru-cache` package (already a dep), `jquery.gritter` vendor lib (already wired into pad.ts).

**Spec:** `docs/superpowers/specs/2026-05-18-outdated-notice-redesign-design.md`

---

## File Structure

**Server (modify):**
- `src/node/updater/versionCompare.ts` — add `isMinorOrMoreBehind`; delete `isMajorBehind`, `isVulnerable`, `parseVulnerableBelow`, `VULN_RE`
- `src/node/updater/types.ts` — drop `VulnerableBelowDirective`, drop `vulnerableBelow` field from `UpdaterState`
- `src/node/updater/state.ts` — stop reading/writing `vulnerableBelow`
- `src/node/updater/VersionChecker.ts` — drop release-notes vulnerable-below scrape
- `src/node/hooks/express/updateStatus.ts` — rewrite `/api/version-status` (pad-aware, first-author gating, per-key LRU cache); add `firstAuthorOf` and `resolveRequestAuthor` helpers
- `src/node/hooks/express/openapi-admin.ts` — update endpoint OpenAPI doc

**Server (test):**
- `src/tests/backend/specs/updateStatus.spec.ts` — new file (no existing test for this module)
- `src/tests/backend/specs/versionCompare.spec.ts` — new file

**Client (modify):**
- `src/templates/pad.html` — delete `#version-badge` div
- `src/static/css/pad.css` — delete `#version-badge` rules
- `src/static/js/pad_version_badge.ts` → renamed `pad_outdated_notice.ts` — rewrite
- `src/static/js/pad.ts` — swap import + invocation site

**Client (test):**
- `src/tests/frontend-new/specs/outdated_notice.spec.ts` — new file

**Build config:**
- Grep for `pad_version_badge` in `vite.config.ts` and any other bundler config; rename refs to `pad_outdated_notice`

**Docs:**
- `doc/api/http_api.md` (and `.adoc` mirror if present) — update `/api/version-status` entry
- `CHANGELOG.md` — Unreleased section entry

---

## Task 1: Add `isMinorOrMoreBehind` helper (test-first)

**Files:**
- Test: `src/tests/backend/specs/versionCompare.spec.ts` (new)
- Modify: `src/node/updater/versionCompare.ts`

- [ ] **Step 1: Write failing tests for the new helper**

Create `src/tests/backend/specs/versionCompare.spec.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {compareSemver, isMinorOrMoreBehind, parseSemver} from '../../../node/updater/versionCompare';

describe('parseSemver', () => {
  it('parses standard semver', () => {
    expect(parseSemver('1.2.3')).toEqual({major: 1, minor: 2, patch: 3});
  });
  it('accepts v-prefix and pre-release', () => {
    expect(parseSemver('v2.7.3-rc.1')).toEqual({major: 2, minor: 7, patch: 3});
  });
  it('rejects garbage', () => {
    expect(parseSemver('not-a-version')).toBeNull();
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('2.7.1.4')).toBeNull();
  });
});

describe('compareSemver', () => {
  it('returns -1, 0, 1', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBe(-1);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.2.4', '1.2.3')).toBe(1);
  });
});

describe('isMinorOrMoreBehind', () => {
  it('returns false for equal versions', () => {
    expect(isMinorOrMoreBehind('3.0.0', '3.0.0')).toBe(false);
  });
  it('returns false for current ahead of latest', () => {
    expect(isMinorOrMoreBehind('3.1.0', '3.0.5')).toBe(false);
  });
  it('returns false for patch-only delta', () => {
    expect(isMinorOrMoreBehind('2.7.3', '2.7.4')).toBe(false);
    expect(isMinorOrMoreBehind('3.0.1', '3.0.9')).toBe(false);
  });
  it('returns true for minor delta', () => {
    expect(isMinorOrMoreBehind('3.1.0', '3.2.0')).toBe(true);
    expect(isMinorOrMoreBehind('3.1.5', '3.2.0')).toBe(true);
  });
  it('returns true for major delta', () => {
    expect(isMinorOrMoreBehind('2.7.3', '3.0.0')).toBe(true);
  });
  it('returns false on unparseable input on either side', () => {
    expect(isMinorOrMoreBehind('garbage', '3.0.0')).toBe(false);
    expect(isMinorOrMoreBehind('3.0.0', 'garbage')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ep_etherpad-lite exec vitest run src/tests/backend/specs/versionCompare.spec.ts`

Expected: FAIL on the `isMinorOrMoreBehind` cases (symbol not exported). `parseSemver` and `compareSemver` cases pass (already exported).

- [ ] **Step 3: Add `isMinorOrMoreBehind`, delete the dead helpers**

Edit `src/node/updater/versionCompare.ts` so its final contents are exactly:

```ts
export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

// Accepts optional prerelease (e.g. -rc.1) and build-metadata (e.g. +build.123).
// Four-part versions like 2.7.1.4 are rejected — use standard semver only.
const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

export const parseSemver = (s: string): ParsedSemver | null => {
  const m = SEMVER_RE.exec(s.trim());
  if (!m) return null;
  return {major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3])};
};

export const compareSemver = (a: string, b: string): -1 | 0 | 1 => {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  return 0;
};

// True iff `current` is at least one minor version behind `latest`.
// Equivalent to: latest.major > current.major, OR same major and
// latest.minor > current.minor. Patch-only deltas return false, equal
// versions return false, current newer than latest returns false.
export const isMinorOrMoreBehind = (current: string, latest: string): boolean => {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return false;
  if (l.major !== c.major) return l.major > c.major;
  return l.minor > c.minor;
};
```

The deletions vs the existing file: drop the `VulnerableBelowDirective` import, `isMajorBehind`, `VULN_RE`, `parseVulnerableBelow`, and `isVulnerable`. Keep `parseSemver` and `compareSemver` unchanged.

- [ ] **Step 4: Re-run tests, verify they pass**

Run: `pnpm --filter ep_etherpad-lite exec vitest run src/tests/backend/specs/versionCompare.spec.ts`
Expected: PASS, all green.

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/versionCompare.ts src/tests/backend/specs/versionCompare.spec.ts
git commit -m "feat(updater): add isMinorOrMoreBehind, drop major/vulnerable helpers"
```

---

## Task 2: Drop `vulnerableBelow` from updater types and state

**Files:**
- Modify: `src/node/updater/types.ts`
- Modify: `src/node/updater/state.ts`
- Modify: `src/node/updater/VersionChecker.ts`

- [ ] **Step 1: Strip `VulnerableBelowDirective` and `vulnerableBelow` from types**

Open `src/node/updater/types.ts`. Locate the `VulnerableBelowDirective` interface (or type) — delete it and any export. In `UpdaterState`, delete the line:

```ts
vulnerableBelow: VulnerableBelowDirective[];
```

(Or similar — exact shape may be `readonly VulnerableBelowDirective[]`; remove either way.)

- [ ] **Step 2: Strip read/write from `state.ts`**

In `src/node/updater/state.ts`:
- In `loadState` (or its parser): delete any line that pulls `vulnerableBelow` out of the JSON. Existing state files with the field still parse — unknown keys are ignored.
- In any `saveState` / `writeState` / serializer: delete the line that writes `vulnerableBelow` back. The field will naturally drop on next write.
- If `state.ts` declares a default/empty `UpdaterState`, remove the `vulnerableBelow: []` line.

- [ ] **Step 3: Strip the release-notes scrape from `VersionChecker.ts`**

In `src/node/updater/VersionChecker.ts`:
- Find the call to `parseVulnerableBelow(releaseBody)` (or any reference to the symbol). Delete it.
- Delete the import of `parseVulnerableBelow` from `./versionCompare`.
- If the checker was assembling a `vulnerableBelow` array to pass to `saveState`, delete that whole branch.

- [ ] **Step 4: Verify nothing else references the deleted symbols**

Run:

```bash
grep -rn "vulnerableBelow\|VulnerableBelowDirective\|parseVulnerableBelow\|isVulnerable\|isMajorBehind" src/node src/tests
```

Expected: NO matches. If any match remains, delete that line/branch too. The most likely stragglers are in `state.ts` defaults, in old test files, or in `updateStatus.ts` (which we rewrite in a later task — leave those references for now if you see them, they'll get cleaned up in Task 5).

- [ ] **Step 5: Verify backend type-checks**

Run:

```bash
pnpm --filter ep_etherpad-lite exec tsc --noEmit
```

Expected: any pre-existing errors are unchanged. If you broke `updateStatus.ts` by removing `isMajorBehind`/`isVulnerable` — that's expected and is fixed in Task 5. To make this task self-contained you may temporarily comment out the broken imports in `updateStatus.ts` with `// FIXME(task-5): rewrite`, but do NOT change behavior.

- [ ] **Step 6: Commit**

```bash
git add src/node/updater/types.ts src/node/updater/state.ts src/node/updater/VersionChecker.ts src/node/hooks/express/updateStatus.ts
git commit -m "refactor(updater): drop vulnerable-below directive and state field"
```

---

## Task 3: Add `firstAuthorOf` helper (test-first)

**Files:**
- Test: `src/tests/backend/specs/firstAuthorOf.spec.ts` (new)
- Modify: `src/node/hooks/express/updateStatus.ts` (add the helper export; full route rewrite happens in Task 5)

- [ ] **Step 1: Write failing tests**

Create `src/tests/backend/specs/firstAuthorOf.spec.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {firstAuthorOf} from '../../../node/hooks/express/updateStatus';

// Minimal fake pad — only `pool.numToAttrib` matters to firstAuthorOf.
const makePad = (entries: Record<number, [string, string]>): any => ({
  pool: {numToAttrib: entries},
});

describe('firstAuthorOf', () => {
  it('returns null for a pad with no attribs', () => {
    expect(firstAuthorOf(makePad({}))).toBeNull();
  });

  it('returns null when no author attribs exist', () => {
    expect(firstAuthorOf(makePad({0: ['bold', 'true'], 1: ['italic', 'true']}))).toBeNull();
  });

  it('returns the only author when there is one', () => {
    expect(firstAuthorOf(makePad({0: ['author', 'a.alice']}))).toBe('a.alice');
  });

  it('returns the lowest-numbered author when there are several', () => {
    expect(firstAuthorOf(makePad({
      0: ['bold', 'true'],
      1: ['author', 'a.alice'],
      2: ['author', 'a.bob'],
    }))).toBe('a.alice');
  });

  it('skips empty-string author placeholders', () => {
    expect(firstAuthorOf(makePad({
      0: ['author', ''],
      1: ['author', 'a.alice'],
    }))).toBe('a.alice');
  });

  it('walks keys in numeric order, not string order', () => {
    expect(firstAuthorOf(makePad({
      10: ['author', 'a.bob'],
      2: ['author', 'a.alice'],
    }))).toBe('a.alice');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ep_etherpad-lite exec vitest run src/tests/backend/specs/firstAuthorOf.spec.ts`
Expected: FAIL with "firstAuthorOf is not a function" (not exported yet).

- [ ] **Step 3: Add the helper, export it**

Open `src/node/hooks/express/updateStatus.ts`. At an appropriate location near the top of the file (after the imports), add:

```ts
import type {PadType} from '../../db/PadType';

/**
 * Returns the authorID of whoever first contributed to the pad — i.e. the
 * `['author', X]` entry at the lowest numeric key in the pool, with empty-X
 * placeholders skipped. Returns null for a pad with no real author attribs yet.
 */
export const firstAuthorOf = (pad: PadType): string | null => {
  const num2attrib = (pad as any).pool?.numToAttrib;
  if (!num2attrib) return null;
  const keys = Object.keys(num2attrib).map(Number).sort((a, b) => a - b);
  for (const k of keys) {
    const a = num2attrib[k];
    if (Array.isArray(a) && a[0] === 'author' && typeof a[1] === 'string' && a[1] !== '') {
      return a[1];
    }
  }
  return null;
};
```

Note: if `PadType` isn't already a usable type, use `import type {PadType} from '../../db/Pad'` instead, or fall back to `any` and rely on the structural access. Confirm the import path that compiles by trying it.

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter ep_etherpad-lite exec vitest run src/tests/backend/specs/firstAuthorOf.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/node/hooks/express/updateStatus.ts src/tests/backend/specs/firstAuthorOf.spec.ts
git commit -m "feat(updater): add firstAuthorOf helper"
```

---

## Task 4: Add `resolveRequestAuthor` helper

**Files:**
- Modify: `src/node/hooks/express/updateStatus.ts`

This helper reads the `express_sid` cookie, looks up the session, and returns the authorID (or null). It does NOT have its own unit test — it requires the live express-session store, so it's exercised end-to-end via the route tests in Task 5.

- [ ] **Step 1: Add the helper**

Open `src/node/hooks/express/updateStatus.ts`. Add this helper after the existing imports (and after `firstAuthorOf` from Task 3):

```ts
import {sessionMiddleware} from '../express';

type SessionGetResult = {user?: {author?: string}} | null | undefined;

/**
 * Resolve the express-session author for a plain HTTP GET. The pad-side fetch
 * is `credentials: 'same-origin'`, so the `express_sid` cookie comes along
 * automatically. We re-enter the session middleware to populate `req.session`
 * the same way express-session does for routed handlers; on any failure we
 * return null and the caller treats the request as anonymous.
 */
export const resolveRequestAuthor = async (req: any): Promise<string | null> => {
  if (req.session && typeof req.session === 'object') {
    const author = (req.session as any).user?.author;
    return typeof author === 'string' && author !== '' ? author : null;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      sessionMiddleware(req, {} as any, (err?: unknown) => err ? reject(err) : resolve());
    });
  } catch {
    return null;
  }
  const author = (req.session as SessionGetResult)?.user?.author;
  return typeof author === 'string' && author !== '' ? author : null;
};
```

Note: the import path for `sessionMiddleware` is whatever the existing express module exports. In Etherpad's tree this is `src/node/hooks/express.ts` exporting `exports.sessionMiddleware`. If TypeScript complains about the import shape, fall back to:

```ts
import * as express from '../express';
const sessionMiddleware = (express as any).sessionMiddleware;
```

inside the helper.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter ep_etherpad-lite exec tsc --noEmit`
Expected: no new errors beyond pre-existing ones.

- [ ] **Step 3: Commit**

```bash
git add src/node/hooks/express/updateStatus.ts
git commit -m "feat(updater): add resolveRequestAuthor helper for HTTP GET"
```

---

## Task 5: Rewrite `/api/version-status` route + cache

**Files:**
- Modify: `src/node/hooks/express/updateStatus.ts`

- [ ] **Step 1: Replace the route, cache, and `computeOutdated` in one edit**

Open `src/node/hooks/express/updateStatus.ts`. Replace the existing module-level cache section (`let badgeCache`, `let badgeInFlight`, `BADGE_CACHE_MS`), the old `computeOutdated`, the existing `app.get('/api/version-status', ...)` route, and `_resetBadgeCacheForTests` with the following. The `/admin/update/status` route below it stays as-is. (Inside the `/admin/update/status` handler, the existing `state.vulnerableBelow` reference also needs to be removed — see Step 2.)

```ts
import {LRUCache} from 'lru-cache';
import padManager from '../../db/PadManager';
import {isMinorOrMoreBehind} from '../../updater/versionCompare';
// (keep existing imports of loadState, stateFilePath, settings, getEpVersion, etc.)
// (firstAuthorOf and resolveRequestAuthor were added in Tasks 3-4 above)

interface OutdatedResponse {
  outdated: 'minor' | null;
  isFirstAuthor: boolean;
}

const EMPTY: OutdatedResponse = {outdated: null, isFirstAuthor: false};

const TTL_MS = 60 * 1000;
let cache = new LRUCache<string, {value: OutdatedResponse; at: number}>({max: 1000});
const inFlight = new Map<string, Promise<OutdatedResponse>>();

/** Test-only setter so a spec can force a tiny cap and assert eviction. */
export const _setBadgeCacheCapForTests = (max: number): void => {
  cache = new LRUCache<string, {value: OutdatedResponse; at: number}>({max});
};

export const _resetBadgeCacheForTests = (): void => {
  cache.clear();
  inFlight.clear();
};

const computeOutdated = async (
  padId: string | null,
  authorId: string | null,
): Promise<OutdatedResponse> => {
  const state = await loadState(stateFilePath());
  if (!state.latest) return EMPTY;
  const current = getEpVersion();
  if (!isMinorOrMoreBehind(current, state.latest.version)) return EMPTY;
  if (!padId || !authorId) return EMPTY;
  if (!padManager.isValidPadId(padId)) return EMPTY;
  if (!(await padManager.doesPadExist(padId))) return EMPTY;
  const pad = await padManager.getPad(padId);
  if (firstAuthorOf(pad) !== authorId) return EMPTY;
  return {outdated: 'minor', isFirstAuthor: true};
};

// In expressCreateServer, replace the existing version-status route:
app.get('/api/version-status', wrapAsync(async (req, res) => {
  const padId = typeof req.query.padId === 'string' ? req.query.padId : null;
  const authorId = await resolveRequestAuthor(req);
  const key = `${padId ?? ''}|${authorId ?? ''}`;
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now - hit.at <= TTL_MS) {
    res.json(hit.value);
    return;
  }

  let flight = inFlight.get(key);
  if (!flight) {
    flight = computeOutdated(padId, authorId).finally(() => inFlight.delete(key));
    inFlight.set(key, flight);
  }
  const value = await flight;
  cache.set(key, {value, at: now});
  res.json(value);
}));
```

- [ ] **Step 2: Strip `vulnerableBelow` from the `/admin/update/status` response**

Still in `updateStatus.ts`, find the `res.json({...})` inside the `/admin/update/status` handler. Delete the `vulnerableBelow: state.vulnerableBelow,` line. The admin payload now reads: `currentVersion, latest, lastCheckAt, installMethod, tier, policy, execution, lastResult, lockHeld`.

- [ ] **Step 3: Type-check**

Run: `pnpm --filter ep_etherpad-lite exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Quick smoke compile**

Run: `pnpm --filter ep_etherpad-lite run build`
Expected: build completes. (We have no behaviour assertions yet — those come in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add src/node/hooks/express/updateStatus.ts
git commit -m "feat(updater): pad-aware /api/version-status with first-author gating"
```

---

## Task 6: End-to-end tests for `/api/version-status`

**Files:**
- Test: `src/tests/backend/specs/updateStatus.spec.ts` (new)

These tests boot a real Etherpad in-process (the same pattern existing api/* specs use), seed a state file, create a pad with two authors, and assert the route's behaviour. Reference existing specs like `src/tests/backend/specs/api/pad.ts` for the boot harness.

- [ ] **Step 1: Write the full spec**

Create `src/tests/backend/specs/updateStatus.spec.ts`:

```ts
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import request from 'supertest';
import {_resetBadgeCacheForTests, _setBadgeCacheCapForTests} from '../../node/hooks/express/updateStatus';
import * as stateMod from '../../node/updater/state';
// Reuse the test harness that other api specs use:
import {init as initEtherpad, app as etherpadApp} from '../common';  // adjust if your harness differs

const PAD_ID = 'outdated-notice-test-pad';
const ALICE = 'a.alice';
const BOB = 'a.bob';

const writeState = async (latestVersion: string | null) => {
  // Stub loadState by spying — simpler than writing a real state.json fixture.
  vi.spyOn(stateMod, 'loadState').mockResolvedValue({
    latest: latestVersion ? {version: latestVersion, releasedAt: '2026-01-01T00:00:00Z'} : null,
    lastCheckAt: null,
    execution: {status: 'idle'},
    lastResult: null,
  } as any);
};

const seedPadWithAuthor = async (firstAuthor: string, secondAuthor?: string) => {
  const padManager = (await import('../../node/db/PadManager')).default;
  const pad = await padManager.getPad(PAD_ID, '', firstAuthor);
  // Touching `pool.putAttrib` mirrors what real edits do; the first call
  // tags `firstAuthor` as the first ['author', X] entry. The second author
  // (if provided) ends up at a higher pool key.
  pad.pool.putAttrib(['author', firstAuthor]);
  if (secondAuthor) pad.pool.putAttrib(['author', secondAuthor]);
  await pad.saveToDatabase?.();
};

const loginAs = async (authorId: string): Promise<string> => {
  // Issue a session-bound cookie tied to authorId by hitting the pad's
  // session-creation endpoint, then reuse the returned `express_sid` cookie.
  // Implementation detail varies per Etherpad's test harness — adapt to the
  // helper your tree provides. The shape we need is:
  //   1. cookie that, on a fresh GET /api/version-status, makes
  //      req.session.user.author === authorId.
  //   2. returns the full Cookie header value.
  // For new harnesses, expose a `loginAs(authorId)` helper that fabricates
  // an express-session row directly via sessionStore.set().
  throw new Error('TODO(plan-task-6): wire to your tree\'s test login helper');
  // Once wired, return the cookie string.
};

describe('GET /api/version-status', () => {
  beforeAll(async () => {
    await initEtherpad();
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    _resetBadgeCacheForTests();
  });

  it('returns EMPTY when no latest is known', async () => {
    await writeState(null);
    const res = await request(etherpadApp).get('/api/version-status').query({padId: PAD_ID});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({outdated: null, isFirstAuthor: false});
  });

  it('returns EMPTY when current >= latest', async () => {
    await writeState('0.0.1');                      // current is whatever package.json says, > 0.0.1
    await seedPadWithAuthor(ALICE);
    const cookie = await loginAs(ALICE);
    const res = await request(etherpadApp)
      .get('/api/version-status')
      .set('Cookie', cookie)
      .query({padId: PAD_ID});
    expect(res.body).toEqual({outdated: null, isFirstAuthor: false});
  });

  it('returns EMPTY when only patch-behind (no padId/author needed)', async () => {
    const current = require('../../../package.json').version as string;          // e.g. '2.7.3'
    const [maj, min, patch] = current.split('.').map(Number);
    await writeState(`${maj}.${min}.${patch + 1}`);
    await seedPadWithAuthor(ALICE);
    const cookie = await loginAs(ALICE);
    const res = await request(etherpadApp)
      .get('/api/version-status')
      .set('Cookie', cookie)
      .query({padId: PAD_ID});
    expect(res.body).toEqual({outdated: null, isFirstAuthor: false});
  });

  it('returns EMPTY when padId omitted, even at minor-behind', async () => {
    await writeState('999.0.0');
    const res = await request(etherpadApp).get('/api/version-status');
    expect(res.body).toEqual({outdated: null, isFirstAuthor: false});
  });

  it('returns EMPTY when author is not pool position 0', async () => {
    await writeState('999.0.0');
    await seedPadWithAuthor(ALICE, BOB);
    const cookie = await loginAs(BOB);
    const res = await request(etherpadApp)
      .get('/api/version-status')
      .set('Cookie', cookie)
      .query({padId: PAD_ID});
    expect(res.body).toEqual({outdated: null, isFirstAuthor: false});
  });

  it('returns {minor, true} for the first author when minor-behind', async () => {
    await writeState('999.0.0');
    await seedPadWithAuthor(ALICE);
    const cookie = await loginAs(ALICE);
    const res = await request(etherpadApp)
      .get('/api/version-status')
      .set('Cookie', cookie)
      .query({padId: PAD_ID});
    expect(res.body).toEqual({outdated: 'minor', isFirstAuthor: true});
  });

  it('caches per (padId, authorId) for 60s', async () => {
    await writeState('999.0.0');
    await seedPadWithAuthor(ALICE);
    const cookie = await loginAs(ALICE);
    const loadSpy = vi.spyOn(stateMod, 'loadState');
    loadSpy.mockClear();

    await request(etherpadApp).get('/api/version-status').set('Cookie', cookie).query({padId: PAD_ID});
    await request(etherpadApp).get('/api/version-status').set('Cookie', cookie).query({padId: PAD_ID});

    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('caches different (padId, authorId) pairs independently', async () => {
    await writeState('999.0.0');
    await seedPadWithAuthor(ALICE);
    const cookieA = await loginAs(ALICE);
    const cookieB = await loginAs(BOB);
    const loadSpy = vi.spyOn(stateMod, 'loadState');
    loadSpy.mockClear();

    await request(etherpadApp).get('/api/version-status').set('Cookie', cookieA).query({padId: PAD_ID});
    await request(etherpadApp).get('/api/version-status').set('Cookie', cookieB).query({padId: PAD_ID});

    expect(loadSpy).toHaveBeenCalledTimes(2);
  });

  it('evicts oldest entry when LRU cap is reached', async () => {
    _setBadgeCacheCapForTests(2);
    await writeState('999.0.0');
    await seedPadWithAuthor(ALICE);
    const cookie = await loginAs(ALICE);
    const loadSpy = vi.spyOn(stateMod, 'loadState');
    loadSpy.mockClear();

    // 3 distinct keys; with cap=2 the 4th call (re-hitting key 1) must miss
    // and re-call loadState.
    await request(etherpadApp).get('/api/version-status').set('Cookie', cookie).query({padId: 'p1'});
    await request(etherpadApp).get('/api/version-status').set('Cookie', cookie).query({padId: 'p2'});
    await request(etherpadApp).get('/api/version-status').set('Cookie', cookie).query({padId: 'p3'});
    await request(etherpadApp).get('/api/version-status').set('Cookie', cookie).query({padId: 'p1'});

    expect(loadSpy).toHaveBeenCalledTimes(4);
  });
});
```

Note: the exact imports for the test harness (`../common`, `initEtherpad`, `etherpadApp`) and the `loginAs` helper depend on your Etherpad tree. Inspect a working api spec (`src/tests/backend/specs/api/pad.ts`) to find the correct names and adapt. If your tree has no `loginAs` helper, add one that does `sessionStore.set(sid, {user: {author}})` directly — that is the minimum surface required.

- [ ] **Step 2: Wire `loginAs` correctly**

Find the existing test harness's session/cookie helper. Likely candidates:

```bash
grep -rn "sessionStore\|express_sid\|loginAs\|setSession" src/tests/backend 2>/dev/null | head
```

If no helper exists, add one in `src/tests/backend/specs/common.ts` (or whichever shared file your harness uses):

```ts
import {sessionMiddleware} from '../../node/hooks/express';
import crypto from 'node:crypto';

// Returns a Cookie header value bound to a session whose user.author === authorId.
export const loginAs = async (authorId: string): Promise<string> => {
  // Implementation: introspect sessionMiddleware to get the store, call store.set
  // with a freshly generated sid, return `express_sid=s%3A<sid>...` cookie.
  // If introspection is awkward, expose the express-session store from
  // express.ts so tests can import it directly.
  // ... (concrete implementation depends on the tree's session config)
};
```

If wiring this proves load-bearing, raise it as a follow-up issue and downgrade Task 6's coverage to the cases that don't need a real cookie (the first three "EMPTY" cases plus the patch-only case can all run without a logged-in session — they assert pre-author short-circuit behaviour).

- [ ] **Step 3: Run, expect pass**

Run: `pnpm --filter ep_etherpad-lite exec vitest run src/tests/backend/specs/updateStatus.spec.ts`
Expected: all cases pass. Any failure here indicates a server bug — fix it inline in `updateStatus.ts`, re-run.

- [ ] **Step 4: Commit**

```bash
git add src/tests/backend/specs/updateStatus.spec.ts src/tests/backend/specs/common.ts
git commit -m "test(updater): end-to-end coverage for /api/version-status"
```

---

## Task 7: Update OpenAPI doc for `/api/version-status`

**Files:**
- Modify: `src/node/hooks/express/openapi-admin.ts`

- [ ] **Step 1: Locate the existing entry**

Open `src/node/hooks/express/openapi-admin.ts`. Grep within the file for `version-status`. The existing entry will describe the path, parameters, and response schema.

- [ ] **Step 2: Update the entry**

Make the entry read (adapt the JS/TS object literal shape to whatever the file uses — usually a plain spec object):

```ts
'/api/version-status': {
  get: {
    summary: 'Outdated-version notice signal for the pad UI',
    description: 'Returns a non-null `outdated` value only to the first author of the supplied pad, and only when the running server is at least one minor version behind the latest published release. Result is cached per (padId, authorId) for 60s.',
    parameters: [
      {
        name: 'padId',
        in: 'query',
        required: false,
        schema: {type: 'string'},
        description: 'Pad whose first-author membership is being checked. Omitted padId always yields a null result.',
      },
    ],
    responses: {
      '200': {
        description: 'Outdated-notice signal.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['outdated', 'isFirstAuthor'],
              properties: {
                outdated: {type: 'string', enum: ['minor'], nullable: true},
                isFirstAuthor: {type: 'boolean'},
              },
            },
          },
        },
      },
    },
  },
},
```

If the existing doc enumerated `severe` and `vulnerable`, those are gone. If it had an admin-only response shape for this route, that was wrong — `/api/version-status` is always public.

- [ ] **Step 3: Verify nothing else references the deleted enum values**

```bash
grep -rn "'severe'\|'vulnerable'" src/node src/static 2>/dev/null
```

Expected: zero matches (CSS rules removed in Task 9, client rewrite in Task 10).

- [ ] **Step 4: Commit**

```bash
git add src/node/hooks/express/openapi-admin.ts
git commit -m "docs(openapi): /api/version-status pad-aware shape and gating"
```

---

## Task 8: Delete `#version-badge` template + CSS

**Files:**
- Modify: `src/templates/pad.html`
- Modify: `src/static/css/pad.css`

- [ ] **Step 1: Delete the template div**

Open `src/templates/pad.html`. At line ~648 there's:

```html
<div id="version-badge" role="status" aria-live="polite" style="display:none"></div>
```

Delete this entire line.

- [ ] **Step 2: Delete the CSS rules**

Open `src/static/css/pad.css`. At line ~119 there's a `#version-badge { ... }` block, followed by `[data-level="severe"]` and `[data-level="vulnerable"]` variants at ~130-131. Delete all three rules (the entire `#version-badge` ruleset including the two data-level variants).

- [ ] **Step 3: Sanity-check nothing else references the id**

```bash
grep -rn "version-badge" src/ 2>/dev/null
```

Expected: zero matches (the JS module gets renamed in the next task).

- [ ] **Step 4: Commit**

```bash
git add src/templates/pad.html src/static/css/pad.css
git commit -m "chore(pad): remove unused #version-badge template and CSS"
```

---

## Task 9: Rename and rewrite the client module

**Files:**
- Rename: `src/static/js/pad_version_badge.ts` → `src/static/js/pad_outdated_notice.ts`
- Modify: `src/static/js/pad.ts`

- [ ] **Step 1: git mv the file**

```bash
git mv src/static/js/pad_version_badge.ts src/static/js/pad_outdated_notice.ts
```

- [ ] **Step 2: Replace its contents wholesale**

Write `src/static/js/pad_outdated_notice.ts` exactly:

```ts
'use strict';

interface OutdatedResponse {
  outdated: 'minor' | null;
  isFirstAuthor: boolean;
}

const apiBasePath = (): string => {
  if (typeof window === 'undefined') return '/';
  return new URL('..', window.location.href).pathname;
};

const currentPadId = (): string | null => {
  const id = (window as any).clientVars?.padId;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

export const maybeShowOutdatedNotice = async (): Promise<void> => {
  const padId = currentPadId();
  if (!padId) return;
  const $ = (window as any).$;
  if (!$ || !$.gritter || typeof $.gritter.add !== 'function') return;

  try {
    const url = `${apiBasePath()}api/version-status?padId=${encodeURIComponent(padId)}`;
    const res = await fetch(url, {credentials: 'same-origin'});
    if (!res.ok) return;
    const data = (await res.json()) as OutdatedResponse;
    if (data.outdated !== 'minor' || !data.isFirstAuthor) return;

    // TODO(i18n): switch to html10n once `pad.outdatedNotice.*` keys land.
    $.gritter.add({
      title: 'Etherpad update available',
      text: 'A newer version of Etherpad has been released. Consider updating this server.',
      sticky: false,
      position: 'bottom',
      class_name: 'outdated-notice',
      time: 8000,
    });
  } catch {
    /* never block pad load */
  }
};
```

The auto-bootstrap-on-DOMContentLoaded block from the old file is GONE — invocation is now explicit, from pad.ts, after `clientVars` is populated.

- [ ] **Step 3: Wire it into pad.ts**

Open `src/static/js/pad.ts`. Two edits:

1. Line ~57 already imports `showPrivacyBannerIfEnabled`. Add right after it (around line 58):

```ts
import {maybeShowOutdatedNotice} from './pad_outdated_notice';
```

2. Line 59 currently reads `import './pad_version_badge';` — delete this line entirely. Replace it with nothing (the explicit import in step 1 above is sufficient; we no longer want the self-bootstrapping side-effect import).

3. Find the existing call site of `showPrivacyBannerIfEnabled` (line ~751). It looks like:

```ts
showPrivacyBannerIfEnabled((clientVars as any).privacyBanner);
```

Add the outdated-notice call immediately after it:

```ts
showPrivacyBannerIfEnabled((clientVars as any).privacyBanner);
void maybeShowOutdatedNotice();
```

`void` because we don't await — the gritter render is fire-and-forget.

- [ ] **Step 4: Grep for stale references**

```bash
grep -rn "pad_version_badge\|renderVersionBadge" src/ 2>/dev/null
```

Expected: zero matches.

- [ ] **Step 5: Bundler config grep + rename**

```bash
grep -rn "pad_version_badge" vite.config.ts webpack.config.* rollup.config.* 2>/dev/null
```

If matches exist, rename to `pad_outdated_notice` in each. Most likely there are none — the pad bundle uses ESM imports rather than explicit entry-point lists.

- [ ] **Step 6: Run the client build, confirm clean**

```bash
pnpm --filter ep_etherpad-lite run build
```

Expected: build succeeds. If it fails on a missing entry, fix per step 5.

- [ ] **Step 7: Commit**

```bash
git add src/static/js/pad_outdated_notice.ts src/static/js/pad.ts
git commit -m "feat(pad): replace persistent badge with first-author outdated gritter"
```

---

## Task 10: Frontend Playwright spec for the outdated notice

**Files:**
- Test: `src/tests/frontend-new/specs/outdated_notice.spec.ts` (new)

Use `src/tests/frontend-new/specs/privacy_banner.spec.ts` as a template — it covers the same shape (gritter-rendered, server-config-driven, Playwright-friendly).

- [ ] **Step 1: Write the spec**

Create `src/tests/frontend-new/specs/outdated_notice.spec.ts`:

```ts
import {test, expect} from '@playwright/test';
import {randomPadName} from '../helper/randomPad';   // adapt to your tree's helper

const stubVersionStatus = (page, payload: {outdated: 'minor' | null, isFirstAuthor: boolean} | 'error') =>
  page.route('**/api/version-status*', (route) => {
    if (payload === 'error') return route.fulfill({status: 500, body: 'oops'});
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

test.describe('outdated notice gritter', () => {
  test('not shown when outdated is null', async ({page}) => {
    await stubVersionStatus(page, {outdated: null, isFirstAuthor: false});
    await page.goto(`/p/${randomPadName()}`);
    await page.waitForSelector('iframe[name="ace_outer"]');
    await page.waitForTimeout(500);
    await expect(page.locator('.gritter-item.outdated-notice')).toHaveCount(0);
  });

  test('not shown when not first author', async ({page}) => {
    await stubVersionStatus(page, {outdated: 'minor', isFirstAuthor: false});
    await page.goto(`/p/${randomPadName()}`);
    await page.waitForSelector('iframe[name="ace_outer"]');
    await page.waitForTimeout(500);
    await expect(page.locator('.gritter-item.outdated-notice')).toHaveCount(0);
  });

  test('shown for first author when minor-behind', async ({page}) => {
    await stubVersionStatus(page, {outdated: 'minor', isFirstAuthor: true});
    await page.goto(`/p/${randomPadName()}`);
    await page.waitForSelector('iframe[name="ace_outer"]');
    const gritter = page.locator('.gritter-item.outdated-notice');
    await expect(gritter).toHaveCount(1);
    await expect(gritter).toContainText('A newer version of Etherpad has been released');
  });

  test('dismissable by user click', async ({page}) => {
    await stubVersionStatus(page, {outdated: 'minor', isFirstAuthor: true});
    await page.goto(`/p/${randomPadName()}`);
    await page.waitForSelector('.gritter-item.outdated-notice');
    await page.locator('.gritter-item.outdated-notice .gritter-close').click();
    await expect(page.locator('.gritter-item.outdated-notice')).toHaveCount(0);
  });

  test('survives a server 500', async ({page}) => {
    await stubVersionStatus(page, 'error');
    await page.goto(`/p/${randomPadName()}`);
    await page.waitForSelector('iframe[name="ace_outer"]');
    await page.waitForTimeout(500);
    await expect(page.locator('.gritter-item.outdated-notice')).toHaveCount(0);
  });

  test('auto-fades after ~8s', async ({page}) => {
    await stubVersionStatus(page, {outdated: 'minor', isFirstAuthor: true});
    await page.goto(`/p/${randomPadName()}`);
    await page.waitForSelector('.gritter-item.outdated-notice');
    // sticky:false + time:8000 → gritter removes itself; allow generous slack
    await page.waitForTimeout(9000);
    await expect(page.locator('.gritter-item.outdated-notice')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Start the dev server**

In a separate terminal:

```bash
pnpm --filter ep_etherpad-lite run dev -- --port 9003
```

(Port 9003 per the `feedback_test_port_9003` rule.)

- [ ] **Step 3: Run the spec under xvfb-run**

```bash
xvfb-run pnpm --filter ep_etherpad-lite exec playwright test src/tests/frontend-new/specs/outdated_notice.spec.ts
```

Expected: all six tests pass. If `randomPadName` import path is wrong, adapt to your tree's helper — it might be inline `Math.random().toString(36)`.

- [ ] **Step 4: Commit**

```bash
git add src/tests/frontend-new/specs/outdated_notice.spec.ts
git commit -m "test(pad): playwright coverage for outdated notice gritter"
```

---

## Task 11: Docs + CHANGELOG

**Files:**
- Modify: `doc/api/http_api.md` (and `doc/api/http_api.adoc` if it exists)
- Modify: `CHANGELOG.md`
- Possibly: `doc/api/updater.md` or `doc/settings.md`

- [ ] **Step 1: Update `doc/api/http_api.md`**

Search inside `doc/api/http_api.md` for any existing `/api/version-status` section. If present, replace it with:

````markdown
#### `GET /api/version-status`

Returns an outdated-version signal intended for the pad-side gritter.

Query parameters:

| name    | type   | required | description                                                                 |
| ------- | ------ | -------- | --------------------------------------------------------------------------- |
| `padId` | string | no       | Pad whose first-author membership is being checked.                         |

Response (200, `application/json`):

```json
{
  "outdated": "minor" | null,
  "isFirstAuthor": true
}
```

`outdated` is `"minor"` only when the running server is at least one minor version behind the latest published release AND the request resolves to the pad's first author. Otherwise it is `null`. Result is cached per (`padId`, `authorId`) for 60s. The endpoint is disabled entirely when `updates.tier = 'off'`.

````

If there is no `/api/version-status` section yet, add the above immediately after whichever public endpoint is most adjacent in the file (e.g. `/api/2/listAllPads`).

- [ ] **Step 2: If `doc/api/http_api.adoc` exists, mirror the change**

```bash
[ -f doc/api/http_api.adoc ] && $EDITOR doc/api/http_api.adoc
```

Convert the markdown above to asciidoc style if so. If the file doesn't exist, skip.

- [ ] **Step 3: Drop vulnerable-below references from `doc/api/updater.md` / `doc/settings.md`**

```bash
grep -rn "vulnerable-below\|vulnerableBelow" doc/ 2>/dev/null
```

For each match: open the file and delete the paragraph(s) that describe the directive or the persistent banner. The `updates.tier` documentation itself stays.

- [ ] **Step 4: Add CHANGELOG entry**

Open `CHANGELOG.md`. Under the existing "Unreleased" or top-of-file section, add:

```markdown
- pad: Outdated-version notice redesigned per #7799. The persistent "severely outdated" banner is replaced by a dismissable gritter, shown only to a pad's first author, only when the server is at least one minor version behind the latest released version (patch-only deltas no longer fire). The `vulnerable-below` directive scraping, the `severe`/`vulnerable` enum values, and the `vulnerableBelow` state field have been removed.
```

- [ ] **Step 5: Commit**

```bash
git add doc/ CHANGELOG.md
git commit -m "docs(pad): outdated-notice redesign + drop vulnerable-below docs"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run full backend test suite**

```bash
pnpm --filter ep_etherpad-lite test:vitest
```

Expected: green. (Per the `feedback_always_run_backend_tests` rule — backend vitest catches source-lint + missing-dep failures that frontend tests don't.)

- [ ] **Step 2: Run frontend Playwright suite**

```bash
xvfb-run pnpm --filter ep_etherpad-lite exec playwright test
```

Expected: green. (`xvfb-run` per `feedback_e2e_xvfb`.)

- [ ] **Step 3: Manual browser check**

In `var/update.state.json`, pin `latest.version` to a value at least one minor ahead of `package.json`'s version (e.g. if package.json is `2.7.3`, set latest to `2.8.0`).

```bash
pnpm --filter ep_etherpad-lite run dev -- --port 9003
```

Open `http://localhost.lan:9003/p/manual-test-pad` in a fresh incognito window (window A). Type one character to register as the first author. Expect the gritter to appear once, bottom-position, with the "Etherpad update available" text. Dismiss with X. Refresh the page — gritter re-appears (per-session-only behaviour, matches the design).

Open the same pad URL in a second incognito window (window B). Type a character. Expect no gritter — you're not pool position 0.

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base develop --title "fix(pad): redesign outdated-version notice (#7799)" --body "$(cat <<'EOF'
## Summary

- Replaces the persistent "severely outdated" banner with a dismissable gritter, shown only to a pad's first author, only when the server is at least one minor version behind the latest published release.
- Drops the `vulnerable-below` directive scraping, the `vulnerable` enum value, and the `vulnerableBelow` state field.
- Adds `isMinorOrMoreBehind`; removes `isMajorBehind` and `isVulnerable`.
- `/api/version-status` becomes pad-aware (`?padId=<id>`) and returns `{outdated: 'minor' | null, isFirstAuthor: boolean}` with per-`(padId, authorId)` 60s LRU caching.

Closes #7799.

## Test plan

- [x] Backend vitest suite green (`pnpm --filter ep_etherpad-lite test:vitest`)
- [x] Frontend Playwright suite green under xvfb (`xvfb-run pnpm exec playwright test`)
- [x] Manual: dev server with `state.json.latest.version` pinned higher than `package.json.version` — gritter appears once for the pad's first author, absent for second visitor

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Per `feedback_qodo_pr_feedback`: fetch Qodo's review comments after the PR opens (`gh api repos/ether/etherpad/pulls/<n>/comments`) and address each one before declaring done.

---

## Self-Review

Run through the spec sections; every requirement maps to a task:

- ✅ Server-gated single-enum response → Task 5
- ✅ `isMinorOrMoreBehind` (new), drop major/vulnerable helpers → Task 1
- ✅ Drop `vulnerableBelow` state/types/scraping → Task 2
- ✅ `firstAuthorOf` (pool position 0, skip empty placeholders) → Task 3
- ✅ `resolveRequestAuthor` (express_sid → session.user.author) → Task 4
- ✅ Per-(padId, authorId) LRU cache + single-flight → Task 5
- ✅ OpenAPI doc update → Task 7
- ✅ Delete `#version-badge` template div + CSS → Task 8
- ✅ Rename module, gritter rewrite, wire from pad.ts → Task 9
- ✅ Backend route tests (cache, eviction, first-author, patch-vs-minor) → Task 6
- ✅ Frontend Playwright (5 cases + auto-fade) → Task 10
- ✅ Docs + CHANGELOG → Task 11
- ✅ Verification gates (full vitest, full playwright, manual browser, port 9003) → Task 12

Type consistency check: `OutdatedResponse` shape is identical across Tasks 5, 6, 9 and 10. `firstAuthorOf` signature is identical between Tasks 3 and 5. `_resetBadgeCacheForTests` and `_setBadgeCacheCapForTests` are introduced in Task 5 and used in Task 6. Good.

Placeholder scan: Task 6 step 1's `loginAs` helper has a `throw new Error('TODO...')` placeholder. This is intentional — the wiring depends on the tree's harness which is faster to inspect than to spec out — and step 2 of the same task contains the recipe for wiring it. Acceptable: it's an explicit instruction to inspect a known file pattern, not an unfilled requirement.
