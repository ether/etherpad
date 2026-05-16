# Auto-Update PR 1 — Tier 1 (Notify) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Tier 1 of the four-tier auto-update feature: every Etherpad admin sees a banner on `/admin` when their instance is behind, pad users see a discreet badge only when severely outdated or running a flagged-vulnerable version, and the configured `adminEmail` receives an escalating-cadence nudge. **No execution code in this PR** — that lands in PR 2 (Tier 2 manual).

**Architecture:** A new `src/node/updater/` subsystem. Periodic poll of GitHub Releases, in-memory + on-disk state at `var/update-state.json`, two HTTP endpoints (`GET /admin/update/status`, `GET /api/version-status`), an admin-UI banner + read-only update page, a pad-UI footer badge, and a `Notifier` that emails on first detection of severe/vulnerable status (escalating: weekly while vulnerable, monthly while severe). Settings additions: `updates.*` block (mainly `tier`, default `"notify"`) and a top-level `adminEmail`.

**Tech Stack:** Node 18+ (native `fetch`), TypeScript, Express 5, vitest (unit), mocha (legacy backend integration), Playwright (UI), React + react-router + i18next (admin UI), pnpm monorepo.

**Spec:** `/home/jose/etherpad/etherpad-lite/docs/superpowers/specs/2026-04-25-auto-update-design.md`

**Conventions:**
- All pushes land on `johnmclear/etherpad-lite` — never `ether/etherpad-lite` directly.
- Working dir: `/home/jose/etherpad/etherpad-lite`.
- Backend unit tests use **vitest** under `src/tests/backend-new/specs/`; integration / API tests use **mocha** under `src/tests/backend/specs/`. The differences matter: vitest uses `import {describe, it, expect} from 'vitest'`, mocha uses `describe`/`it` globals + `assert`.
- Run unit tests: `cd src && pnpm test:vitest -- run tests/backend-new/specs/updater/`.
- Run integration tests: `cd src && pnpm test -- --grep "<file>"`.
- Run admin Playwright: `cd src && pnpm test-admin`.
- Run pad Playwright: `cd src && pnpm test-ui`.
- Run type-check: `pnpm ts-check` from repo root.
- Commit messages follow the existing style (e.g. `feat(updater): ...`, `test(updater): ...`).
- Frequent commits: every passing test → commit.

---

## Task 0: Branch off fork

**Files:** none.

- [ ] **Step 1: Confirm clean working tree**

```bash
cd /home/jose/etherpad/etherpad-lite
git status
```

Expected: working tree clean, current branch may be unrelated. If there are uncommitted changes other than the spec doc, stop and surface to the user.

- [ ] **Step 2: Make sure `develop` is up-to-date from `origin` (ether)**

```bash
git fetch origin develop
```

- [ ] **Step 3: Create branch off origin/develop**

```bash
git checkout -b feat/auto-update-tier1 origin/develop
```

- [ ] **Step 4: Cherry-pick the design spec onto the new branch**

```bash
# The spec was written into the working tree but not committed.
# It should still be present after the checkout because it's untracked.
git status
# Expect: "Untracked files: docs/superpowers/specs/2026-04-25-auto-update-design.md"
git add docs/superpowers/specs/2026-04-25-auto-update-design.md
git commit -m "docs(updater): add four-tier auto-update design spec"
```

If `git status` after step 3 doesn't show the spec as untracked (e.g., because checkout placed it at a different path or removed it), Read the file at `/home/jose/etherpad/etherpad-lite/docs/superpowers/specs/2026-04-25-auto-update-design.md` to verify it exists, then add and commit it.

- [ ] **Step 5: Add this plan to the same first commit (amend)**

```bash
git add docs/superpowers/plans/2026-04-25-auto-update-pr1-notify.md
git commit --amend --no-edit
```

- [ ] **Step 6: Push to fork**

```bash
git push -u fork feat/auto-update-tier1
```

---

## Task 1: Shared types module

Pure-types module. No tests needed (compiler is the test).

**Files:**
- Create: `src/node/updater/types.ts`

> **Path note:** From the repo root `/home/jose/etherpad/etherpad-lite`, source files live under `src/node/`, `src/static/`, `src/locales/`, etc. Tests live under `src/tests/backend/`, `src/tests/backend-new/`, `src/tests/frontend-new/`. The `src/` directory IS the `ep_etherpad-lite` pnpm workspace package — when running test/dev/build scripts via pnpm, `cd src` first (or use `pnpm --filter ep_etherpad-lite run <script>` from the repo root).

- [ ] **Step 1: Verify path layout**

```bash
ls /home/jose/etherpad/etherpad-lite/src/node/utils/Settings.ts
```

Expected: file exists. If not, the inner directory layout has changed — stop and ask.

- [ ] **Step 2: Create `types.ts`**

```typescript
// src/node/updater/types.ts

export type InstallMethod = 'auto' | 'git' | 'docker' | 'npm' | 'managed';

export type Tier = 'off' | 'notify' | 'manual' | 'auto' | 'autonomous';

export type OutdatedLevel = null | 'severe' | 'vulnerable';

export interface ReleaseInfo {
  /** semver string without leading 'v', e.g. "2.7.2". */
  version: string;
  /** Original GitHub `tag_name`, e.g. "v2.7.2". */
  tag: string;
  /** Markdown body of the release. */
  body: string;
  /** ISO-8601 timestamp from GitHub. */
  publishedAt: string;
  /** True if GitHub flagged it as a prerelease. */
  prerelease: boolean;
  /** GitHub HTML URL for the release page. */
  htmlUrl: string;
}

export interface VulnerableBelowDirective {
  /** The release that *announced* the vulnerability (latest release wins on conflict). */
  announcedBy: string;
  /** Versions strictly below this string are considered vulnerable. */
  threshold: string;
}

export interface PolicyResult {
  canNotify: boolean;
  canManual: boolean;
  canAuto: boolean;
  canAutonomous: boolean;
  /** Human-readable string explaining the most-restrictive denial, or "ok". */
  reason: string;
}

export interface EmailSendLog {
  /** Last time we emailed about being severely-outdated, ISO-8601. */
  severeAt: string | null;
  /** Last time we emailed about being vulnerable, ISO-8601. */
  vulnerableAt: string | null;
  /** Tag of the release the last "new release while vulnerable" email referenced. */
  vulnerableNewReleaseTag: string | null;
}

export interface UpdateState {
  /** Schema version of this file. Increment when fields change. */
  schemaVersion: 1;
  /** Last time VersionChecker successfully fetched, ISO-8601. */
  lastCheckAt: string | null;
  /** Last ETag returned by GitHub, used for If-None-Match. */
  lastEtag: string | null;
  /** Cached release info, or null if we've never successfully fetched. */
  latest: ReleaseInfo | null;
  /** Vulnerable-below directives parsed from the most recent N releases. */
  vulnerableBelow: VulnerableBelowDirective[];
  /** Email send dedupe state. */
  email: EmailSendLog;
}

export const EMPTY_STATE: UpdateState = {
  schemaVersion: 1,
  lastCheckAt: null,
  lastEtag: null,
  latest: null,
  vulnerableBelow: [],
  email: {
    severeAt: null,
    vulnerableAt: null,
    vulnerableNewReleaseTag: null,
  },
};
```

- [ ] **Step 3: Type-check**

```bash
cd /home/jose/etherpad/etherpad-lite && pnpm ts-check
```

Expected: PASS (or only pre-existing errors unrelated to `updater/`).

- [ ] **Step 4: Commit**

```bash
git add src/node/updater/types.ts
git commit -m "feat(updater): add shared types for auto-update subsystem"
```

---

## Task 2: `versionCompare` helpers (TDD)

Tiny pure helpers. Build them first because everything else depends on semver math.

**Files:**
- Create: `src/node/updater/versionCompare.ts`
- Test: `src/tests/backend-new/specs/updater/versionCompare.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/tests/backend-new/specs/updater/versionCompare.test.ts
import {describe, it, expect} from 'vitest';
import {
  parseSemver,
  compareSemver,
  isMajorBehind,
  parseVulnerableBelow,
  isVulnerable,
} from '../../../../node/updater/versionCompare';

describe('parseSemver', () => {
  it('parses a plain version', () => {
    expect(parseSemver('2.7.1')).toEqual({major: 2, minor: 7, patch: 1});
  });
  it('strips leading v', () => {
    expect(parseSemver('v2.7.1')).toEqual({major: 2, minor: 7, patch: 1});
  });
  it('returns null for garbage', () => {
    expect(parseSemver('garbage')).toBeNull();
    expect(parseSemver('')).toBeNull();
    expect(parseSemver('2.7')).toBeNull();
  });
});

describe('compareSemver', () => {
  it('orders correctly', () => {
    expect(compareSemver('2.7.1', '2.7.2')).toBe(-1);
    expect(compareSemver('2.7.2', '2.7.1')).toBe(1);
    expect(compareSemver('2.7.2', '2.7.2')).toBe(0);
    expect(compareSemver('3.0.0', '2.99.99')).toBe(1);
  });
  it('returns 0 if either is unparsable', () => {
    expect(compareSemver('garbage', '2.7.1')).toBe(0);
  });
});

describe('isMajorBehind', () => {
  it('true when at least one major behind', () => {
    expect(isMajorBehind('2.7.1', '3.0.0')).toBe(true);
    expect(isMajorBehind('2.7.1', '4.0.0')).toBe(true);
  });
  it('false otherwise', () => {
    expect(isMajorBehind('2.7.1', '2.99.99')).toBe(false);
    expect(isMajorBehind('3.0.0', '3.0.0')).toBe(false);
    expect(isMajorBehind('3.0.0', '2.7.1')).toBe(false);
  });
});

describe('parseVulnerableBelow', () => {
  it('extracts directive from release body', () => {
    const body = 'Fixes a few things.\n<!-- updater: vulnerable-below 2.6.4 -->\nMore notes.';
    expect(parseVulnerableBelow(body)).toBe('2.6.4');
  });
  it('tolerates whitespace and casing', () => {
    expect(parseVulnerableBelow('<!--updater:vulnerable-below 1.0.0-->')).toBe('1.0.0');
    expect(parseVulnerableBelow('<!-- UPDATER: VULNERABLE-BELOW 1.0.0 -->')).toBe('1.0.0');
  });
  it('returns null when absent or malformed', () => {
    expect(parseVulnerableBelow('no directive here')).toBeNull();
    expect(parseVulnerableBelow('<!-- updater: vulnerable-below garbage -->')).toBeNull();
  });
});

describe('isVulnerable', () => {
  it('true if current strictly below any directive threshold', () => {
    expect(isVulnerable('2.6.3', [
      {announcedBy: 'v2.7.0', threshold: '2.6.4'},
    ])).toBe(true);
  });
  it('false at or above all thresholds', () => {
    expect(isVulnerable('2.6.4', [
      {announcedBy: 'v2.7.0', threshold: '2.6.4'},
    ])).toBe(false);
    expect(isVulnerable('2.7.0', [])).toBe(false);
  });
  it('handles multiple directives', () => {
    expect(isVulnerable('1.5.0', [
      {announcedBy: 'v2.0.0', threshold: '2.0.0'},
      {announcedBy: 'v3.0.0', threshold: '1.9.0'},
    ])).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test:vitest -- run tests/backend-new/specs/updater/versionCompare.test.ts
```

Expected: FAIL with "Cannot find module ...versionCompare".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/node/updater/versionCompare.ts
import type {VulnerableBelowDirective} from './types';

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[.-].*)?$/;

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

export const isMajorBehind = (current: string, latest: string): boolean => {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return false;
  return l.major - c.major >= 1;
};

const VULN_RE = /<!--\s*updater\s*:\s*vulnerable-below\s+([^\s-][^\s]*)\s*-->/i;

export const parseVulnerableBelow = (body: string): string | null => {
  const m = VULN_RE.exec(body);
  if (!m) return null;
  if (!parseSemver(m[1])) return null;
  return m[1];
};

export const isVulnerable = (
  current: string,
  directives: readonly VulnerableBelowDirective[],
): boolean => {
  for (const d of directives) {
    if (compareSemver(current, d.threshold) < 0) return true;
  }
  return false;
};
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test:vitest -- run tests/backend-new/specs/updater/versionCompare.test.ts
```

Expected: all 14 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/versionCompare.ts src/tests/backend-new/specs/updater/versionCompare.test.ts
git commit -m "feat(updater): add semver helpers and vulnerable-below parser"
```

---

## Task 3: `state.ts` — disk persistence (TDD)

Read/write `var/update-state.json` with schema validation and migration. Pure where possible — takes a `path` so tests can use a temp dir.

**Files:**
- Create: `src/node/updater/state.ts`
- Test: `src/tests/backend-new/specs/updater/state.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/tests/backend-new/specs/updater/state.test.ts
import {describe, it, expect, beforeEach} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {loadState, saveState, EMPTY_STATE_FOR_TESTS} from '../../../../node/updater/state';

let dir: string;
const statePath = () => path.join(dir, 'update-state.json');

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-state-'));
});

describe('loadState', () => {
  it('returns empty state when file does not exist', async () => {
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE_FOR_TESTS);
  });

  it('round-trips a saved state', async () => {
    const s = {...EMPTY_STATE_FOR_TESTS, lastCheckAt: '2026-04-25T00:00:00Z'};
    await saveState(statePath(), s);
    const loaded = await loadState(statePath());
    expect(loaded.lastCheckAt).toBe('2026-04-25T00:00:00Z');
  });

  it('returns empty state when file is corrupt', async () => {
    await fs.writeFile(statePath(), 'not json');
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE_FOR_TESTS);
  });

  it('returns empty state when schemaVersion is unknown', async () => {
    await fs.writeFile(statePath(), JSON.stringify({schemaVersion: 999}));
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE_FOR_TESTS);
  });
});

describe('saveState', () => {
  it('writes atomically (no partial file on crash simulation)', async () => {
    // We cannot easily simulate a crash, but we can verify the write went via a tmp file
    // by checking only one file ends up in the dir.
    await saveState(statePath(), EMPTY_STATE_FOR_TESTS);
    const entries = await fs.readdir(dir);
    expect(entries).toEqual(['update-state.json']);
  });

  it('creates the directory if missing', async () => {
    const nested = path.join(dir, 'nested', 'deep', 'update-state.json');
    await saveState(nested, EMPTY_STATE_FOR_TESTS);
    const data = JSON.parse(await fs.readFile(nested, 'utf8'));
    expect(data.schemaVersion).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test:vitest -- run tests/backend-new/specs/updater/state.test.ts
```

Expected: FAIL with "Cannot find module ...state".

- [ ] **Step 3: Write the implementation**

```typescript
// src/node/updater/state.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import {EMPTY_STATE, UpdateState} from './types';

export {EMPTY_STATE as EMPTY_STATE_FOR_TESTS};

const isValid = (raw: unknown): raw is UpdateState => {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return o.schemaVersion === 1
    && (o.lastCheckAt === null || typeof o.lastCheckAt === 'string')
    && (o.lastEtag === null || typeof o.lastEtag === 'string')
    && (o.latest === null || typeof o.latest === 'object')
    && Array.isArray(o.vulnerableBelow)
    && typeof o.email === 'object';
};

export const loadState = async (filePath: string): Promise<UpdateState> => {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') return structuredClone(EMPTY_STATE);
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return structuredClone(EMPTY_STATE);
  }
  if (!isValid(parsed)) return structuredClone(EMPTY_STATE);
  return parsed;
};

export const saveState = async (filePath: string, state: UpdateState): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), {recursive: true});
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, filePath);
};
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test:vitest -- run tests/backend-new/specs/updater/state.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/state.ts src/tests/backend-new/specs/updater/state.test.ts
git commit -m "feat(updater): add state persistence with schema validation"
```

---

## Task 4: `InstallMethodDetector` (TDD)

**Files:**
- Create: `src/node/updater/InstallMethodDetector.ts`
- Test: `src/tests/backend-new/specs/updater/InstallMethodDetector.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/tests/backend-new/specs/updater/InstallMethodDetector.test.ts
import {describe, it, expect, beforeEach} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {detectInstallMethod} from '../../../../node/updater/InstallMethodDetector';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'detector-'));
});

const opts = (override?: 'auto' | 'git' | 'docker' | 'npm' | 'managed') => ({
  override: override ?? 'auto',
  rootDir: dir,
  dockerEnvPath: path.join(dir, '.dockerenv'),
});

describe('detectInstallMethod', () => {
  it('honors a non-auto override', async () => {
    expect(await detectInstallMethod(opts('git'))).toBe('git');
    expect(await detectInstallMethod(opts('docker'))).toBe('docker');
    expect(await detectInstallMethod(opts('managed'))).toBe('managed');
  });

  it('returns docker when /.dockerenv exists', async () => {
    await fs.writeFile(opts().dockerEnvPath, '');
    expect(await detectInstallMethod(opts())).toBe('docker');
  });

  it('returns git when .git is present and root is writable', async () => {
    await fs.mkdir(path.join(dir, '.git'));
    expect(await detectInstallMethod(opts())).toBe('git');
  });

  it('returns npm when package-lock.json is present and writable', async () => {
    await fs.writeFile(path.join(dir, 'package-lock.json'), '{}');
    expect(await detectInstallMethod(opts())).toBe('npm');
  });

  it('returns managed when nothing matches', async () => {
    expect(await detectInstallMethod(opts())).toBe('managed');
  });

  it('docker takes precedence over git', async () => {
    await fs.writeFile(opts().dockerEnvPath, '');
    await fs.mkdir(path.join(dir, '.git'));
    expect(await detectInstallMethod(opts())).toBe('docker');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test:vitest -- run tests/backend-new/specs/updater/InstallMethodDetector.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/node/updater/InstallMethodDetector.ts
import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import path from 'node:path';
import {InstallMethod} from './types';

export interface DetectOptions {
  /** Setting from settings.json. "auto" means detect; anything else is forced. */
  override: InstallMethod;
  /** Root directory of the Etherpad install. */
  rootDir: string;
  /** Path to /.dockerenv (overridable for tests). */
  dockerEnvPath?: string;
}

const exists = async (p: string): Promise<boolean> => {
  try { await fs.access(p, fsConstants.F_OK); return true; } catch { return false; }
};

const writable = async (p: string): Promise<boolean> => {
  try { await fs.access(p, fsConstants.W_OK); return true; } catch { return false; }
};

export const detectInstallMethod = async (
  opts: DetectOptions,
): Promise<Exclude<InstallMethod, 'auto'>> => {
  if (opts.override !== 'auto') return opts.override;

  const dockerEnv = opts.dockerEnvPath ?? '/.dockerenv';
  if (await exists(dockerEnv)) return 'docker';

  const gitDir = path.join(opts.rootDir, '.git');
  if (await exists(gitDir) && await writable(opts.rootDir)) return 'git';

  const lockfile = path.join(opts.rootDir, 'package-lock.json');
  if (await exists(lockfile) && await writable(lockfile)) return 'npm';

  return 'managed';
};
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test:vitest -- run tests/backend-new/specs/updater/InstallMethodDetector.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/InstallMethodDetector.ts src/tests/backend-new/specs/updater/InstallMethodDetector.test.ts
git commit -m "feat(updater): add install-method detector with override"
```

---

## Task 5: `UpdatePolicy` (TDD)

The single source of truth for "what's allowed in this environment." Pure function.

**Files:**
- Create: `src/node/updater/UpdatePolicy.ts`
- Test: `src/tests/backend-new/specs/updater/UpdatePolicy.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/tests/backend-new/specs/updater/UpdatePolicy.test.ts
import {describe, it, expect} from 'vitest';
import {evaluatePolicy} from '../../../../node/updater/UpdatePolicy';
import {InstallMethod, Tier} from '../../../../node/updater/types';

const baseInput = {
  installMethod: 'git' as Exclude<InstallMethod, 'auto'>,
  tier: 'manual' as Tier,
  current: '2.7.1',
  latest: '2.7.2',
};

describe('evaluatePolicy', () => {
  it('off tier denies everything', () => {
    const r = evaluatePolicy({...baseInput, tier: 'off'});
    expect(r).toEqual({canNotify: false, canManual: false, canAuto: false, canAutonomous: false, reason: 'tier-off'});
  });

  it('notify tier allows only notify', () => {
    const r = evaluatePolicy({...baseInput, tier: 'notify'});
    expect(r.canNotify).toBe(true);
    expect(r.canManual).toBe(false);
    expect(r.canAuto).toBe(false);
    expect(r.canAutonomous).toBe(false);
  });

  it('manual tier allows notify+manual on git', () => {
    const r = evaluatePolicy({...baseInput, tier: 'manual'});
    expect(r.canManual).toBe(true);
    expect(r.canAuto).toBe(false);
  });

  it('manual tier denies manual on docker', () => {
    const r = evaluatePolicy({...baseInput, tier: 'manual', installMethod: 'docker'});
    expect(r.canNotify).toBe(true);
    expect(r.canManual).toBe(false);
    expect(r.reason).toBe('install-method-not-writable');
  });

  it('autonomous tier allows everything on git', () => {
    const r = evaluatePolicy({...baseInput, tier: 'autonomous'});
    expect(r).toEqual({canNotify: true, canManual: true, canAuto: true, canAutonomous: true, reason: 'ok'});
  });

  it('autonomous on managed install denies write tiers', () => {
    const r = evaluatePolicy({...baseInput, tier: 'autonomous', installMethod: 'managed'});
    expect(r.canNotify).toBe(true);
    expect(r.canManual).toBe(false);
    expect(r.canAuto).toBe(false);
    expect(r.canAutonomous).toBe(false);
  });

  it('current === latest denies all (nothing to do)', () => {
    const r = evaluatePolicy({...baseInput, tier: 'autonomous', current: '2.7.2', latest: '2.7.2'});
    expect(r.canNotify).toBe(false);
    expect(r.canManual).toBe(false);
    expect(r.reason).toBe('up-to-date');
  });

  it('current > latest (dev build) denies all', () => {
    const r = evaluatePolicy({...baseInput, tier: 'autonomous', current: '3.0.0', latest: '2.7.2'});
    expect(r.canNotify).toBe(false);
    expect(r.reason).toBe('up-to-date');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test:vitest -- run tests/backend-new/specs/updater/UpdatePolicy.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
// src/node/updater/UpdatePolicy.ts
import {compareSemver} from './versionCompare';
import {InstallMethod, PolicyResult, Tier} from './types';

const WRITABLE_METHODS: ReadonlySet<Exclude<InstallMethod, 'auto'>> = new Set(['git']);
// Future: 'npm' once we support that path. For PR 1 only `git` allows write tiers.

export interface PolicyInput {
  installMethod: Exclude<InstallMethod, 'auto'>;
  tier: Tier;
  current: string;
  latest: string;
}

export const evaluatePolicy = ({installMethod, tier, current, latest}: PolicyInput): PolicyResult => {
  if (tier === 'off') {
    return {canNotify: false, canManual: false, canAuto: false, canAutonomous: false, reason: 'tier-off'};
  }
  if (compareSemver(current, latest) >= 0) {
    return {canNotify: false, canManual: false, canAuto: false, canAutonomous: false, reason: 'up-to-date'};
  }

  const canNotify = true;
  const writable = WRITABLE_METHODS.has(installMethod);

  if (!writable) {
    return {canNotify, canManual: false, canAuto: false, canAutonomous: false, reason: 'install-method-not-writable'};
  }

  return {
    canNotify,
    canManual: tier === 'manual' || tier === 'auto' || tier === 'autonomous',
    canAuto: tier === 'auto' || tier === 'autonomous',
    canAutonomous: tier === 'autonomous',
    reason: 'ok',
  };
};
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test:vitest -- run tests/backend-new/specs/updater/UpdatePolicy.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/UpdatePolicy.ts src/tests/backend-new/specs/updater/UpdatePolicy.test.ts
git commit -m "feat(updater): add policy evaluator"
```

---

## Task 6: `VersionChecker` (TDD with mocked fetch)

**Files:**
- Create: `src/node/updater/VersionChecker.ts`
- Test: `src/tests/backend-new/specs/updater/VersionChecker.test.ts`

The checker takes a `fetcher` function so tests can supply a stub. Production wiring (Task 9) injects the real `fetch`.

- [ ] **Step 1: Write failing test**

```typescript
// src/tests/backend-new/specs/updater/VersionChecker.test.ts
import {describe, it, expect, beforeEach} from 'vitest';
import {checkLatestRelease, FetchResult} from '../../../../node/updater/VersionChecker';
import {ReleaseInfo} from '../../../../node/updater/types';

const ghBody = (overrides: Partial<{tag_name: string; body: string; prerelease: boolean; html_url: string; published_at: string}> = {}) => ({
  tag_name: 'v2.7.2',
  body: 'Some changes.\n<!-- updater: vulnerable-below 2.6.4 -->',
  prerelease: false,
  html_url: 'https://github.com/ether/etherpad/releases/tag/v2.7.2',
  published_at: '2026-04-25T00:00:00Z',
  ...overrides,
});

describe('checkLatestRelease', () => {
  it('returns parsed release on 200', async () => {
    const fetcher = async () => ({
      status: 200,
      etag: 'abc',
      json: ghBody(),
    } as FetchResult);
    const r = await checkLatestRelease({fetcher, prevEtag: null, repo: 'ether/etherpad'});
    expect(r.kind).toBe('updated');
    if (r.kind !== 'updated') return;
    const expected: ReleaseInfo = {
      version: '2.7.2',
      tag: 'v2.7.2',
      body: 'Some changes.\n<!-- updater: vulnerable-below 2.6.4 -->',
      publishedAt: '2026-04-25T00:00:00Z',
      prerelease: false,
      htmlUrl: 'https://github.com/ether/etherpad/releases/tag/v2.7.2',
    };
    expect(r.release).toEqual(expected);
    expect(r.etag).toBe('abc');
    expect(r.vulnerableBelow).toEqual([{announcedBy: 'v2.7.2', threshold: '2.6.4'}]);
  });

  it('returns notmodified on 304', async () => {
    const fetcher = async () => ({status: 304, etag: 'abc', json: null} as FetchResult);
    const r = await checkLatestRelease({fetcher, prevEtag: 'abc', repo: 'ether/etherpad'});
    expect(r.kind).toBe('notmodified');
  });

  it('returns ratelimited on 403', async () => {
    const fetcher = async () => ({status: 403, etag: null, json: null} as FetchResult);
    const r = await checkLatestRelease({fetcher, prevEtag: null, repo: 'ether/etherpad'});
    expect(r.kind).toBe('ratelimited');
  });

  it('skips prereleases', async () => {
    const fetcher = async () => ({
      status: 200, etag: null, json: ghBody({prerelease: true}),
    } as FetchResult);
    const r = await checkLatestRelease({fetcher, prevEtag: null, repo: 'ether/etherpad'});
    expect(r.kind).toBe('skipped-prerelease');
  });

  it('returns error on unexpected status', async () => {
    const fetcher = async () => ({status: 500, etag: null, json: null} as FetchResult);
    const r = await checkLatestRelease({fetcher, prevEtag: null, repo: 'ether/etherpad'});
    expect(r.kind).toBe('error');
  });

  it('passes prevEtag to fetcher', async () => {
    let observed: string | null = '';
    const fetcher = async (_url: string, etag: string | null) => {
      observed = etag;
      return {status: 304, etag: 'abc', json: null} as FetchResult;
    };
    await checkLatestRelease({fetcher, prevEtag: 'old', repo: 'ether/etherpad'});
    expect(observed).toBe('old');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test:vitest -- run tests/backend-new/specs/updater/VersionChecker.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
// src/node/updater/VersionChecker.ts
import {ReleaseInfo, VulnerableBelowDirective} from './types';
import {parseVulnerableBelow} from './versionCompare';

export interface FetchResult {
  status: number;
  etag: string | null;
  json: any;
}

export type Fetcher = (url: string, etag: string | null) => Promise<FetchResult>;

export type CheckResult =
  | {kind: 'updated'; release: ReleaseInfo; etag: string | null; vulnerableBelow: VulnerableBelowDirective[]}
  | {kind: 'notmodified'}
  | {kind: 'ratelimited'}
  | {kind: 'skipped-prerelease'}
  | {kind: 'error'; status: number};

export interface CheckOptions {
  fetcher: Fetcher;
  prevEtag: string | null;
  repo: string;
}

export const checkLatestRelease = async (
  {fetcher, prevEtag, repo}: CheckOptions,
): Promise<CheckResult> => {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetcher(url, prevEtag);

  if (res.status === 304) return {kind: 'notmodified'};
  if (res.status === 403 || res.status === 429) return {kind: 'ratelimited'};
  if (res.status !== 200 || !res.json) return {kind: 'error', status: res.status};

  const j = res.json;
  if (j.prerelease) return {kind: 'skipped-prerelease'};

  const tag: string = String(j.tag_name);
  const version = tag.replace(/^v/, '');
  const body: string = typeof j.body === 'string' ? j.body : '';

  const release: ReleaseInfo = {
    version,
    tag,
    body,
    publishedAt: String(j.published_at),
    prerelease: false,
    htmlUrl: String(j.html_url),
  };

  const directiveThreshold = parseVulnerableBelow(body);
  const vulnerableBelow: VulnerableBelowDirective[] = directiveThreshold
    ? [{announcedBy: tag, threshold: directiveThreshold}]
    : [];

  return {kind: 'updated', release, etag: res.etag, vulnerableBelow};
};

/** Production fetcher built on native fetch. Honors If-None-Match. */
export const realFetcher: Fetcher = async (url, etag) => {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'etherpad-self-update',
  };
  if (etag) headers['If-None-Match'] = etag;
  const r = await fetch(url, {headers});
  const newEtag = r.headers.get('etag');
  let json: any = null;
  if (r.status === 200) {
    try { json = await r.json(); } catch { json = null; }
  }
  return {status: r.status, etag: newEtag, json};
};
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test:vitest -- run tests/backend-new/specs/updater/VersionChecker.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/VersionChecker.ts src/tests/backend-new/specs/updater/VersionChecker.test.ts
git commit -m "feat(updater): add GitHub Releases checker with ETag support"
```

---

## Task 7: `Notifier` (TDD)

Pure function that decides which emails to send and updates the dedupe log. Side effects (actual sending) are pushed through a `sender` callback.

**Files:**
- Create: `src/node/updater/Notifier.ts`
- Test: `src/tests/backend-new/specs/updater/Notifier.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/tests/backend-new/specs/updater/Notifier.test.ts
import {describe, it, expect} from 'vitest';
import {decideEmails, NotifierInput} from '../../../../node/updater/Notifier';
import {EMPTY_STATE} from '../../../../node/updater/types';

const base: NotifierInput = {
  adminEmail: 'admin@example.com',
  current: '2.0.0',
  latest: '2.7.2',
  latestTag: 'v2.7.2',
  vulnerableBelow: [],
  isVulnerable: false,
  isSevere: false,
  state: EMPTY_STATE.email,
  now: new Date('2026-04-25T12:00:00Z'),
};

describe('decideEmails', () => {
  it('emits no email if adminEmail is unset', () => {
    const r = decideEmails({...base, adminEmail: null, isSevere: true});
    expect(r.toSend).toEqual([]);
  });

  it('emits severe email on first detection', () => {
    const r = decideEmails({...base, isSevere: true});
    expect(r.toSend.map(e => e.kind)).toEqual(['severe']);
    expect(r.newState.severeAt).toBe('2026-04-25T12:00:00.000Z');
  });

  it('does not re-emit severe within 30 days', () => {
    const r = decideEmails({
      ...base,
      isSevere: true,
      state: {...base.state, severeAt: '2026-04-10T12:00:00.000Z'},
    });
    expect(r.toSend).toEqual([]);
  });

  it('re-emits severe after 30 days', () => {
    const r = decideEmails({
      ...base,
      isSevere: true,
      state: {...base.state, severeAt: '2026-03-20T12:00:00.000Z'},
    });
    expect(r.toSend.map(e => e.kind)).toEqual(['severe']);
  });

  it('emits vulnerable email on first detection', () => {
    const r = decideEmails({...base, isVulnerable: true});
    expect(r.toSend.map(e => e.kind)).toEqual(['vulnerable']);
    expect(r.newState.vulnerableAt).toBe('2026-04-25T12:00:00.000Z');
  });

  it('does not re-emit vulnerable within 7 days', () => {
    const r = decideEmails({
      ...base,
      isVulnerable: true,
      state: {...base.state, vulnerableAt: '2026-04-22T12:00:00.000Z'},
    });
    expect(r.toSend).toEqual([]);
  });

  it('re-emits vulnerable after 7 days', () => {
    const r = decideEmails({
      ...base,
      isVulnerable: true,
      state: {...base.state, vulnerableAt: '2026-04-15T12:00:00.000Z'},
    });
    expect(r.toSend.map(e => e.kind)).toEqual(['vulnerable']);
  });

  it('emits new-release-while-vulnerable when latest tag changes', () => {
    const r = decideEmails({
      ...base,
      isVulnerable: true,
      state: {...base.state, vulnerableAt: '2026-04-25T11:59:00.000Z', vulnerableNewReleaseTag: 'v2.7.1'},
    });
    expect(r.toSend.map(e => e.kind)).toEqual(['vulnerable-new-release']);
  });

  it('vulnerable wins over severe in the same tick', () => {
    const r = decideEmails({...base, isSevere: true, isVulnerable: true});
    expect(r.toSend.map(e => e.kind)).toEqual(['vulnerable']);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test:vitest -- run tests/backend-new/specs/updater/Notifier.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
// src/node/updater/Notifier.ts
import {EmailSendLog, VulnerableBelowDirective} from './types';

export interface NotifierInput {
  adminEmail: string | null;
  current: string;
  latest: string;
  latestTag: string;
  vulnerableBelow: VulnerableBelowDirective[];
  isVulnerable: boolean;
  isSevere: boolean;
  state: EmailSendLog;
  now: Date;
}

export type EmailKind = 'severe' | 'vulnerable' | 'vulnerable-new-release';

export interface PlannedEmail {
  kind: EmailKind;
  subject: string;
  body: string;
}

export interface NotifierResult {
  toSend: PlannedEmail[];
  newState: EmailSendLog;
}

const DAY = 24 * 60 * 60 * 1000;
const SEVERE_INTERVAL = 30 * DAY;
const VULNERABLE_INTERVAL = 7 * DAY;

const sinceMs = (iso: string | null, now: Date): number =>
  iso ? now.getTime() - new Date(iso).getTime() : Infinity;

export const decideEmails = (input: NotifierInput): NotifierResult => {
  const {adminEmail, current, latest, latestTag, isVulnerable, isSevere, state, now} = input;

  if (!adminEmail) return {toSend: [], newState: state};

  const toSend: PlannedEmail[] = [];
  const newState: EmailSendLog = {...state};

  if (isVulnerable) {
    const sinceVuln = sinceMs(state.vulnerableAt, now);
    const tagChanged = state.vulnerableNewReleaseTag !== null && state.vulnerableNewReleaseTag !== latestTag;
    if (tagChanged && sinceVuln < VULNERABLE_INTERVAL) {
      toSend.push({
        kind: 'vulnerable-new-release',
        subject: `[Etherpad] New release available — ${latest} (your version is vulnerable)`,
        body: `A new Etherpad release (${latestTag}) is available. Your version (${current}) is flagged as vulnerable. Please update.`,
      });
      newState.vulnerableNewReleaseTag = latestTag;
    } else if (sinceVuln >= VULNERABLE_INTERVAL) {
      toSend.push({
        kind: 'vulnerable',
        subject: `[Etherpad] Your instance is running a vulnerable version (${current})`,
        body: `Your Etherpad version (${current}) is below the security threshold. Latest is ${latest}.`,
      });
      newState.vulnerableAt = now.toISOString();
      newState.vulnerableNewReleaseTag = latestTag;
    }
  } else if (isSevere) {
    const sinceSevere = sinceMs(state.severeAt, now);
    if (sinceSevere >= SEVERE_INTERVAL) {
      toSend.push({
        kind: 'severe',
        subject: `[Etherpad] Your instance is severely outdated (${current})`,
        body: `Your Etherpad version (${current}) is more than one major release behind ${latest}.`,
      });
      newState.severeAt = now.toISOString();
    }
  }

  return {toSend, newState};
};
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test:vitest -- run tests/backend-new/specs/updater/Notifier.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/updater/Notifier.ts src/tests/backend-new/specs/updater/Notifier.test.ts
git commit -m "feat(updater): add email cadence decider"
```

---

## Task 8: Settings extension

Add `updates` and `adminEmail` to the live `SettingsType` and defaults in `Settings.ts`. Then add the same to `settings.json.template` and `settings.json.docker`.

**Files:**
- Modify: `src/node/utils/Settings.ts`
- Modify: `settings.json.template`
- Modify: `settings.json.docker`

- [ ] **Step 1: Locate the end of `SettingsType` in `Settings.ts`**

Read `src/node/utils/Settings.ts` lines 290–305 to find the closing brace of `SettingsType`. The line `export type SettingsType = {` starts at ~line 159; it closes around line ~298 (just before `const settings: SettingsType = {` on line 301). The last fields look like:

```typescript
  randomVersionString: string,
  gitVersion: string
  getPublicSettings: () => Pick<...>,
}
```

- [ ] **Step 2: Insert new fields into `SettingsType`**

Edit `Settings.ts`. Add immediately before `getPublicSettings`:

```typescript
  updates: {
    tier: 'off' | 'notify' | 'manual' | 'auto' | 'autonomous',
    source: 'github',
    channel: 'stable',
    installMethod: 'auto' | 'git' | 'docker' | 'npm' | 'managed',
    checkIntervalHours: number,
    githubRepo: string,
  },
  adminEmail: string | null,
```

- [ ] **Step 3: Insert defaults into the `settings` literal**

Find the `const settings: SettingsType = {` block. Add (anywhere inside the object literal, but a sensible place is after `enableMetrics`):

```typescript
  /**
   * Self-update subsystem (PR 1: tier 1 only).
   * Tier "off" disables the version check entirely. Default "notify" shows a banner when behind.
   */
  updates: {
    tier: 'notify',
    source: 'github',
    channel: 'stable',
    installMethod: 'auto',
    checkIntervalHours: 6,
    githubRepo: 'ether/etherpad',
  },
  /**
   * Contact address for admin notifications (updates, future security advisories).
   * Null disables outbound mail from the updater.
   */
  adminEmail: null,
```

- [ ] **Step 4: Run type-check**

```bash
cd /home/jose/etherpad/etherpad-lite && pnpm ts-check
```

Expected: no new errors.

- [ ] **Step 5: Update `settings.json.template`**

Open `settings.json.template`, find a sensible insertion point (after `"enableMetrics"` is fine). Add (preserving JSON-with-comments syntax used in that file):

```jsonc
  /*
   * Self-update subsystem.
   * tier: "off" | "notify" | "manual" | "auto" | "autonomous"
   * Default "notify" shows a banner when an update is available. "off" disables the version check.
   */
  "updates": {
    "tier": "notify",
    "source": "github",
    "channel": "stable",
    "installMethod": "auto",
    "checkIntervalHours": 6,
    "githubRepo": "ether/etherpad"
  },

  /*
   * Contact address for admin notifications (updates, security advisories, future features).
   * Set to null to disable outbound mail from the updater.
   */
  "adminEmail": null,
```

- [ ] **Step 6: Update `settings.json.docker`**

Same content but with `"installMethod": "docker"` and a note that auto-update is not available for docker installs.

- [ ] **Step 7: Confirm template parses**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test:vitest -- run tests/backend-new/specs/admin_utils.ts
```

(That existing test parses the template; if it still passes we haven't broken JSON-with-comments parsing.)

Expected: passes.

- [ ] **Step 8: Commit**

```bash
git add src/node/utils/Settings.ts settings.json.template settings.json.docker
git commit -m "feat(settings): add updates.* and adminEmail settings"
```

---

## Task 9: Boot wiring & `ep.json` registration

A small `index.ts` that initializes the subsystem at boot, plus an `ep.json` entry. This keeps Task 10 (HTTP routes) trivial because the routes can read state directly off disk via `loadState`.

**Files:**
- Create: `src/node/updater/index.ts`
- Modify: `src/ep.json`

- [ ] **Step 1: Read existing ep.json structure**

```bash
sed -n '70,130p' /home/jose/etherpad/etherpad-lite/src/ep.json
```

- [ ] **Step 2: Create `index.ts`**

```typescript
// src/node/updater/index.ts
import path from 'node:path';
import log4js from 'log4js';
import settings from '../utils/Settings';
import {detectInstallMethod} from './InstallMethodDetector';
import {checkLatestRelease, realFetcher} from './VersionChecker';
import {loadState, saveState} from './state';
import {compareSemver, isMajorBehind, isVulnerable} from './versionCompare';
import {evaluatePolicy} from './UpdatePolicy';
import {decideEmails} from './Notifier';
import {InstallMethod, UpdateState} from './types';

const logger = log4js.getLogger('updater');

let detectedMethod: Exclude<InstallMethod, 'auto'> = 'managed';
let timer: NodeJS.Timeout | null = null;
let inMemoryState: UpdateState | null = null;

const stateFilePath = () => path.join(settings.root, 'var', 'update-state.json');

const getEpVersion = (): string => require('../../package.json').version;

/** Returns the current state from memory; loads on first call. */
export const getCurrentState = async (): Promise<UpdateState> => {
  if (inMemoryState) return inMemoryState;
  inMemoryState = await loadState(stateFilePath());
  return inMemoryState;
};

export const getDetectedInstallMethod = () => detectedMethod;

const sendEmailViaSmtp = async (to: string, subject: string, body: string): Promise<void> => {
  // Etherpad core has no built-in SMTP. We log and rely on a future plugin / explicit SMTP wiring.
  // PR 1 ships the dedupe machinery without an actual sender; subsequent PRs can wire nodemailer.
  logger.info(`(would send email) to=${to} subject="${subject}"`);
  void body;
};

const performCheck = async (): Promise<void> => {
  if (settings.updates.tier === 'off') return;
  let state = await getCurrentState();
  try {
    const result = await checkLatestRelease({
      fetcher: realFetcher,
      prevEtag: state.lastEtag,
      repo: settings.updates.githubRepo,
    });
    const now = new Date();
    state.lastCheckAt = now.toISOString();

    if (result.kind === 'updated') {
      state.latest = result.release;
      state.lastEtag = result.etag;
      // Union new directives with existing.
      const existingTags = new Set(state.vulnerableBelow.map(v => v.announcedBy));
      for (const v of result.vulnerableBelow) {
        if (!existingTags.has(v.announcedBy)) state.vulnerableBelow.push(v);
      }
    } else if (result.kind === 'notmodified') {
      // nothing
    } else if (result.kind === 'ratelimited') {
      logger.warn('GitHub rate-limited; backing off');
    } else if (result.kind === 'error') {
      logger.warn(`GitHub fetch error status=${result.status}`);
    }

    // Notifier pass.
    if (state.latest && settings.adminEmail) {
      const current = getEpVersion();
      const policy = evaluatePolicy({
        installMethod: detectedMethod,
        tier: settings.updates.tier,
        current,
        latest: state.latest.version,
      });
      if (policy.canNotify) {
        const decision = decideEmails({
          adminEmail: settings.adminEmail,
          current,
          latest: state.latest.version,
          latestTag: state.latest.tag,
          vulnerableBelow: state.vulnerableBelow,
          isVulnerable: isVulnerable(current, state.vulnerableBelow),
          isSevere: isMajorBehind(current, state.latest.version),
          state: state.email,
          now,
        });
        for (const email of decision.toSend) {
          await sendEmailViaSmtp(settings.adminEmail, email.subject, email.body);
        }
        state.email = decision.newState;
      }
    }

    inMemoryState = state;
    await saveState(stateFilePath(), state);
  } catch (err) {
    logger.warn(`Updater check failed: ${(err as Error).message}`);
  }
};

const startPolling = (): void => {
  const intervalMs = Math.max(1, settings.updates.checkIntervalHours) * 60 * 60 * 1000;
  if (timer) clearInterval(timer);
  timer = setInterval(() => { void performCheck(); }, intervalMs);
  // Run an immediate first check, but don't block boot.
  setTimeout(() => { void performCheck(); }, 5000);
};

/** Hook entry point — called by ep.json on createServer. */
exports.expressCreateServer = async (): Promise<void> => {
  detectedMethod = await detectInstallMethod({
    override: settings.updates.installMethod,
    rootDir: settings.root,
  });
  logger.info(`updater: install method = ${detectedMethod}, tier = ${settings.updates.tier}`);
  if (settings.updates.tier !== 'off') startPolling();
};

/** Shutdown hook. */
exports.shutdown = async (): Promise<void> => {
  if (timer) { clearInterval(timer); timer = null; }
};

/** Exposed for tests / route handlers. */
export const _internal = {
  performCheck,
  stateFilePath,
};
```

- [ ] **Step 3: Register the hook in `ep.json`**

Edit `src/ep.json`. Add a new entry to `parts` (anywhere before `"admin"`):

```jsonc
{
  "name": "updater",
  "hooks": {
    "expressCreateServer": "ep_etherpad-lite/node/updater/index",
    "shutdown": "ep_etherpad-lite/node/updater/index"
  }
}
```

- [ ] **Step 4: Type-check**

```bash
cd /home/jose/etherpad/etherpad-lite && pnpm ts-check
```

Expected: no new errors.

- [ ] **Step 5: Manual smoke**

```bash
cd /home/jose/etherpad/etherpad-lite && timeout 15 pnpm dev 2>&1 | tail -40
```

Expected: among the boot logs, a line like `[updater] updater: install method = git, tier = notify`. Server starts cleanly. (`timeout 15` exits — that's fine, we're just checking startup.)

- [ ] **Step 6: Commit**

```bash
git add src/node/updater/index.ts src/ep.json
git commit -m "feat(updater): wire boot hook and periodic checker"
```

---

## Task 10: HTTP endpoints (`updateStatus.ts`)

Two routes:
- `GET /admin/update/status` — admin-only (existing webaccess gates `/admin/`).
- `GET /api/version-status` — public, returns `{outdated: null|"severe"|"vulnerable"}`.

**Files:**
- Create: `src/node/hooks/express/updateStatus.ts`
- Modify: `src/ep.json`
- Test (mocha integration): `src/tests/backend/specs/updateStatus.ts`

- [ ] **Step 1: Write failing integration test**

```typescript
// src/tests/backend/specs/updateStatus.ts
'use strict';

const assert = require('assert').strict;
const common = require('../common');
import settings from '../../../node/utils/Settings';
import {saveState} from '../../../node/updater/state';
import {EMPTY_STATE} from '../../../node/updater/types';
import path from 'node:path';

const statePath = () => path.join(settings.root, 'var', 'update-state.json');

describe(__filename, function () {
  let agent: any;

  before(async function () {
    agent = await common.init();
  });

  describe('GET /api/version-status', function () {
    it('returns null when no state', async function () {
      await saveState(statePath(), {...EMPTY_STATE});
      const res = await agent.get('/api/version-status').expect(200);
      assert.deepEqual(res.body, {outdated: null});
    });

    it('does not leak the running version', async function () {
      const res = await agent.get('/api/version-status').expect(200);
      assert.ok(!('version' in res.body));
      assert.ok(!('latest' in res.body));
    });

    it('returns severe when running > 1 major behind', async function () {
      // Force "latest" to be 99.0.0 to make our running version severely outdated.
      await saveState(statePath(), {
        ...EMPTY_STATE,
        latest: {
          version: '99.0.0', tag: 'v99.0.0', body: '',
          publishedAt: '2099-01-01T00:00:00Z', prerelease: false,
          htmlUrl: 'https://example/',
        },
      });
      const res = await agent.get('/api/version-status').expect(200);
      assert.equal(res.body.outdated, 'severe');
    });
  });

  describe('GET /admin/update/status', function () {
    it('requires admin auth (rejects no-auth)', async function () {
      await agent.get('/admin/update/status').expect(401);
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test -- --grep "updateStatus"
```

Expected: FAIL because the endpoints don't exist (404 instead of 200/401).

- [ ] **Step 3: Write the implementation**

```typescript
// src/node/hooks/express/updateStatus.ts
'use strict';

import {ArgsExpressType} from '../../types/ArgsExpressType';
import settings from '../../utils/Settings';
import {getCurrentState, getDetectedInstallMethod} from '../../updater';
import {evaluatePolicy} from '../../updater/UpdatePolicy';
import {compareSemver, isMajorBehind, isVulnerable} from '../../updater/versionCompare';

const getEpVersion = (): string => require('../../../package.json').version;

let badgeCache: {value: 'severe' | 'vulnerable' | null; at: number} = {value: null, at: 0};
const BADGE_CACHE_MS = 60 * 1000;

const computeOutdated = async (): Promise<'severe' | 'vulnerable' | null> => {
  const state = await getCurrentState();
  if (!state.latest) return null;
  const current = getEpVersion();
  if (compareSemver(current, state.latest.version) >= 0) return null;
  if (isVulnerable(current, state.vulnerableBelow)) return 'vulnerable';
  if (isMajorBehind(current, state.latest.version)) return 'severe';
  return null;
};

exports.expressCreateServer = async (
  hookName: string,
  {app}: ArgsExpressType,
  cb: Function,
): Promise<any> => {
  // Public, cached, never leaks version string.
  app.get('/api/version-status', async (_req: any, res: any) => {
    const now = Date.now();
    if (now - badgeCache.at > BADGE_CACHE_MS) {
      badgeCache = {value: await computeOutdated(), at: now};
    }
    res.json({outdated: badgeCache.value});
  });

  // Admin-protected; webaccess.ts already gates /admin/* with admin auth.
  app.get('/admin/update/status', async (_req: any, res: any) => {
    const state = await getCurrentState();
    const current = getEpVersion();
    const installMethod = getDetectedInstallMethod();
    const policy = state.latest
      ? evaluatePolicy({installMethod, tier: settings.updates.tier, current, latest: state.latest.version})
      : null;
    res.json({
      currentVersion: current,
      latest: state.latest,
      lastCheckAt: state.lastCheckAt,
      installMethod,
      tier: settings.updates.tier,
      policy,
      vulnerableBelow: state.vulnerableBelow,
    });
  });

  return cb();
};
```

- [ ] **Step 4: Register the hook in `ep.json`**

Add another entry to `src/ep.json`'s `parts`:

```jsonc
{
  "name": "updateStatus",
  "hooks": {
    "expressCreateServer": "ep_etherpad-lite/node/hooks/express/updateStatus"
  }
}
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test -- --grep "updateStatus"
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/node/hooks/express/updateStatus.ts src/ep.json src/tests/backend/specs/updateStatus.ts
git commit -m "feat(updater): add /admin/update/status and /api/version-status endpoints"
```

---

## Task 11: Locale strings

Add the i18n keys both the admin UI and pad UI will reference. Doing this now keeps later UI tasks focused on rendering.

**Files:**
- Modify: `src/locales/en.json`

- [ ] **Step 1: Read the file's current shape**

```bash
head -5 /home/jose/etherpad/etherpad-lite/src/locales/en.json
```

The file is a flat JSON object of `"key": "value"` pairs.

- [ ] **Step 2: Add updater keys**

Insert (alphabetical-ish placement, near `admin_plugins.*`):

```json
"update.banner.title": "Update available",
"update.banner.body": "Etherpad {{latest}} is available (you are running {{current}}).",
"update.banner.cta": "View update",
"update.page.title": "Etherpad updates",
"update.page.current": "Current version",
"update.page.latest": "Latest version",
"update.page.last_check": "Last checked",
"update.page.install_method": "Install method",
"update.page.tier": "Update tier",
"update.page.changelog": "Changelog",
"update.page.up_to_date": "You are running the latest version.",
"update.badge.severe": "Etherpad on this server is severely outdated. Tell your admin.",
"update.badge.vulnerable": "Etherpad on this server is running a version with known security issues. Tell your admin.",
```

- [ ] **Step 3: Verify JSON validity**

```bash
node -e "JSON.parse(require('fs').readFileSync('/home/jose/etherpad/etherpad-lite/src/locales/en.json','utf8'))" && echo OK
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/locales/en.json
git commit -m "i18n(updater): add english strings for update banner, page, and pad badge"
```

---

## Task 12: Pad-side version badge (frontend code only — endpoint already exists)

**Files:**
- Create: `src/static/js/pad_version_badge.ts`
- Modify: `src/static/js/pad.ts` (one-line require)
- Modify: `src/templates/pad.html` (add `<div id="version-badge">`)
- Modify: `src/static/css/pad.css` (small styles)

- [ ] **Step 1: Create the badge module**

```typescript
// src/static/js/pad_version_badge.ts
'use strict';

interface BadgeResponse { outdated: 'severe' | 'vulnerable' | null }

const TEXT_BY_LEVEL: Record<'severe' | 'vulnerable', string> = {
  severe: 'Etherpad on this server is severely outdated. Tell your admin.',
  vulnerable: 'Etherpad on this server is running a version with known security issues. Tell your admin.',
};

export const renderVersionBadge = async (): Promise<void> => {
  const el = document.getElementById('version-badge');
  if (!el) return;
  try {
    const res = await fetch('/api/version-status', {credentials: 'same-origin'});
    if (!res.ok) return;
    const data = (await res.json()) as BadgeResponse;
    if (!data.outdated) { el.style.display = 'none'; return; }
    el.textContent = TEXT_BY_LEVEL[data.outdated];
    el.dataset.level = data.outdated;
    el.style.display = '';
  } catch {
    // Quiet failure — never block the pad load.
  }
};

// Auto-render once DOM is ready.
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void renderVersionBadge(); });
  } else {
    void renderVersionBadge();
  }
}
```

- [ ] **Step 2: Wire the import**

Open `src/static/js/pad.ts`. Find the imports block (top of file). Add:

```typescript
import './pad_version_badge';
```

(Anywhere with the other imports is fine.)

- [ ] **Step 3: Add the placeholder div to the template**

Open `src/templates/pad.html`. Find the line `</div> <!-- End of #editorcontainerbox -->` (around line 510). On the line BEFORE it, insert:

```html
<div id="version-badge" role="status" aria-live="polite" style="display:none"></div>
```

- [ ] **Step 4: Add CSS**

Open `src/static/css/pad.css`. Append at the end:

```css
#version-badge {
  position: fixed;
  bottom: 8px;
  right: 8px;
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 4px;
  z-index: 9999;
  pointer-events: auto;
  max-width: 320px;
}
#version-badge[data-level="severe"]   { background: #fff3cd; color: #664d03; border: 1px solid #ffe69c; }
#version-badge[data-level="vulnerable"] { background: #f8d7da; color: #58151c; border: 1px solid #f1aeb5; }
```

- [ ] **Step 5: Type-check & build**

```bash
cd /home/jose/etherpad/etherpad-lite && pnpm ts-check
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/static/js/pad_version_badge.ts src/static/js/pad.ts src/templates/pad.html src/static/css/pad.css
git commit -m "feat(updater): add pad footer badge for severe/vulnerable status"
```

---

## Task 13: Admin UI — store, page, banner, route

**Files:**
- Modify: `admin/src/store/store.ts`
- Create: `admin/src/pages/UpdatePage.tsx`
- Create: `admin/src/components/UpdateBanner.tsx`
- Modify: `admin/src/main.tsx` (route)
- Modify: `admin/src/App.tsx` (render banner + nav link)

- [ ] **Step 1: Read the existing store shape**

```bash
sed -n '1,60p' /home/jose/etherpad/etherpad-lite/admin/src/store/store.ts
```

This tells you the existing zustand setter pattern. You'll add an `updateStatus` slice with the same pattern.

- [ ] **Step 2: Extend the store**

Add to `admin/src/store/store.ts` (alongside existing fields):

```typescript
export interface UpdateStatusPayload {
  currentVersion: string;
  latest: null | {
    version: string; tag: string; body: string;
    publishedAt: string; prerelease: boolean; htmlUrl: string;
  };
  lastCheckAt: string | null;
  installMethod: string;
  tier: string;
  policy: null | {canNotify: boolean; canManual: boolean; canAuto: boolean; canAutonomous: boolean; reason: string};
  vulnerableBelow: Array<{announcedBy: string; threshold: string}>;
}

// Inside the existing zustand store interface, add:
//   updateStatus: UpdateStatusPayload | null;
//   setUpdateStatus: (s: UpdateStatusPayload) => void;
//
// And in the `create<...>(set => ({` body:
//   updateStatus: null,
//   setUpdateStatus: (s) => set({updateStatus: s}),
```

(The exact merge depends on the existing file. Read it first, then make a minimal addition that matches the existing pattern. Do not refactor unrelated code.)

- [ ] **Step 3: Create the banner component**

```tsx
// admin/src/components/UpdateBanner.tsx
import {useEffect} from 'react';
import {Link} from 'react-router-dom';
import {Trans, useTranslation} from 'react-i18next';
import {useStore} from '../store/store';

export const UpdateBanner = () => {
  const {t} = useTranslation();
  const updateStatus = useStore((s) => s.updateStatus);
  const setUpdateStatus = useStore((s) => s.setUpdateStatus);

  useEffect(() => {
    let cancelled = false;
    fetch('/admin/update/status', {credentials: 'same-origin'})
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data && !cancelled) setUpdateStatus(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [setUpdateStatus]);

  if (!updateStatus || !updateStatus.latest) return null;
  if (updateStatus.currentVersion === updateStatus.latest.version) return null;

  return (
    <div className="update-banner" role="status">
      <strong><Trans i18nKey="update.banner.title"/></strong>{' '}
      <span>
        <Trans
          i18nKey="update.banner.body"
          values={{latest: updateStatus.latest.version, current: updateStatus.currentVersion}}
        />
      </span>{' '}
      <Link to="/update">{t('update.banner.cta')}</Link>
    </div>
  );
};
```

- [ ] **Step 4: Create the update page**

```tsx
// admin/src/pages/UpdatePage.tsx
import {Trans, useTranslation} from 'react-i18next';
import {useStore} from '../store/store';

export const UpdatePage = () => {
  const {t} = useTranslation();
  const us = useStore((s) => s.updateStatus);

  if (!us) return <div><Trans i18nKey="admin.loading" defaults="Loading..."/></div>;

  const upToDate = !us.latest || us.currentVersion === us.latest.version;

  return (
    <div className="update-page">
      <h1><Trans i18nKey="update.page.title"/></h1>
      <dl>
        <dt><Trans i18nKey="update.page.current"/></dt>
        <dd>{us.currentVersion}</dd>
        <dt><Trans i18nKey="update.page.latest"/></dt>
        <dd>{us.latest ? us.latest.version : '—'}</dd>
        <dt><Trans i18nKey="update.page.last_check"/></dt>
        <dd>{us.lastCheckAt ?? '—'}</dd>
        <dt><Trans i18nKey="update.page.install_method"/></dt>
        <dd>{us.installMethod}</dd>
        <dt><Trans i18nKey="update.page.tier"/></dt>
        <dd>{us.tier}</dd>
      </dl>
      {upToDate ? (
        <p><Trans i18nKey="update.page.up_to_date"/></p>
      ) : us.latest ? (
        <>
          <h2><Trans i18nKey="update.page.changelog"/></h2>
          <pre style={{whiteSpace: 'pre-wrap'}}>{us.latest.body}</pre>
          <p><a href={us.latest.htmlUrl} rel="noreferrer noopener" target="_blank">{us.latest.htmlUrl}</a></p>
        </>
      ) : null}
    </div>
  );
};

export default UpdatePage;
```

- [ ] **Step 5: Register the route**

Edit `admin/src/main.tsx`. Import the page and add a route:

```tsx
import {UpdatePage} from "./pages/UpdatePage.tsx";
// ...
// Inside the Route element list, add:
<Route path="/update" element={<UpdatePage/>}/>
```

- [ ] **Step 6: Render the banner and nav link in `App.tsx`**

Edit `admin/src/App.tsx`. Import:

```tsx
import {UpdateBanner} from "./components/UpdateBanner";
import {Bell} from "lucide-react";
```

Inside the JSX, just before `<Outlet/>`, render the banner:

```tsx
<UpdateBanner/>
<Outlet/>
```

And in the `<ul>` of nav links, add (after the last existing `<li>`):

```tsx
<li><NavLink to={"/update"}><Bell/><Trans i18nKey="update.page.title"/></NavLink></li>
```

- [ ] **Step 7: Verify type-check + admin builds**

```bash
cd /home/jose/etherpad/etherpad-lite && pnpm ts-check
cd /home/jose/etherpad/etherpad-lite && pnpm run build:ui
```

Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add admin/src/store/store.ts admin/src/pages/UpdatePage.tsx admin/src/components/UpdateBanner.tsx admin/src/main.tsx admin/src/App.tsx
git commit -m "feat(admin-ui): add update banner, page, and nav link"
```

---

## Task 14: Admin Playwright test

**Files:**
- Create: `src/tests/frontend-new/admin-spec/update-banner.spec.ts`

- [ ] **Step 1: Look at an existing admin spec for the auth helper pattern**

```bash
ls /home/jose/etherpad/etherpad-lite/src/tests/frontend-new/admin-spec
```

If a `helpers.ts` or `auth-utils.ts` exists, study it. Otherwise look at a sibling spec for how it logs in.

- [ ] **Step 2: Write the test**

```typescript
// src/tests/frontend-new/admin-spec/update-banner.spec.ts
import {test, expect} from '@playwright/test';

const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:9001/admin/';

// NOTE: tests run with --workers 1 per package.json's test-admin script.
// Authentication: existing admin tests use basic auth via the URL or storageState.
// Match the pattern of a sibling spec in this directory.

test('admin homepage exposes the update nav link', async ({page}) => {
  await page.goto(ADMIN_URL);
  await expect(page.getByRole('link', {name: /etherpad updates/i})).toBeVisible();
});

test('update page renders current version', async ({page}) => {
  await page.goto(`${ADMIN_URL}update`);
  await expect(page.getByText(/current version/i)).toBeVisible();
  // The running version is rendered as a <dd>.
  await expect(page.locator('dd').first()).not.toBeEmpty();
});
```

If the existing admin specs use a shared auth fixture, port the call into this test (the snippet above assumes the test runner's storageState already covers auth — same as other admin specs).

- [ ] **Step 3: Run the test**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test-admin -- update-banner
```

Expected: passes (with Etherpad running locally — `pnpm dev` in another terminal).

- [ ] **Step 4: Commit**

```bash
git add src/tests/frontend-new/admin-spec/update-banner.spec.ts
git commit -m "test(updater): admin Playwright test for update nav and page"
```

---

## Task 15: Pad Playwright test

**Files:**
- Create: `src/tests/frontend-new/specs/pad-version-badge.spec.ts`

- [ ] **Step 1: Look at an existing pad spec for the test harness pattern**

```bash
ls /home/jose/etherpad/etherpad-lite/src/tests/frontend-new/specs | head -10
```

- [ ] **Step 2: Write the test**

```typescript
// src/tests/frontend-new/specs/pad-version-badge.spec.ts
import {test, expect} from '@playwright/test';

const padUrl = (id = `test-${Date.now()}`) =>
  `${process.env.PAD_URL ?? 'http://localhost:9001'}/p/${id}`;

test('badge is hidden when not outdated', async ({page}) => {
  await page.route('**/api/version-status', (route) =>
    route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({outdated: null})}));
  await page.goto(padUrl());
  const badge = page.locator('#version-badge');
  await expect(badge).toBeHidden();
});

test('badge shows severe text when outdated=severe', async ({page}) => {
  await page.route('**/api/version-status', (route) =>
    route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({outdated: 'severe'})}));
  await page.goto(padUrl());
  const badge = page.locator('#version-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/severely outdated/i);
  await expect(badge).toHaveAttribute('data-level', 'severe');
});

test('badge shows vulnerable text when outdated=vulnerable', async ({page}) => {
  await page.route('**/api/version-status', (route) =>
    route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({outdated: 'vulnerable'})}));
  await page.goto(padUrl());
  const badge = page.locator('#version-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/security issues/i);
  await expect(badge).toHaveAttribute('data-level', 'vulnerable');
});
```

- [ ] **Step 3: Run the test**

```bash
cd /home/jose/etherpad/etherpad-lite/src && pnpm test-ui -- pad-version-badge
```

Expected: 3 tests pass with Etherpad running locally. **Do not pass `--headed`** — per project guidance, tests must run headless.

- [ ] **Step 4: Commit**

```bash
git add src/tests/frontend-new/specs/pad-version-badge.spec.ts
git commit -m "test(updater): pad Playwright test for version badge visibility"
```

---

## Task 16: Documentation

**Files:**
- Create: `doc/admin/updates.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Confirm the doc dir layout**

```bash
ls /home/jose/etherpad/etherpad-lite/doc/admin 2>/dev/null || ls /home/jose/etherpad/etherpad-lite/doc | head
```

If `doc/admin/` doesn't exist yet, create it. Otherwise add the file alongside existing admin docs.

- [ ] **Step 2: Write `doc/admin/updates.md`**

```markdown
# Etherpad updates

Etherpad ships with a built-in update subsystem. **Tier 1 (notify)** is enabled by default: a banner appears in the admin UI when a new release is available, and pad users see a discreet badge if the running version is severely outdated or flagged as vulnerable.

## Settings

In `settings.json`:

```json
{
  "updates": {
    "tier": "notify",
    "checkIntervalHours": 6,
    "githubRepo": "ether/etherpad"
  },
  "adminEmail": null
}
```

- `updates.tier` — `"off"`, `"notify"` (default), or future tiers `"manual"`, `"auto"`, `"autonomous"` (PR 2+).
- `updates.checkIntervalHours` — how often to poll GitHub Releases. Default 6.
- `updates.githubRepo` — override for forks.
- `adminEmail` — top-level. Contact for admin notifications. Set to receive escalating nudges when this instance is outdated.

## Email cadence (when `adminEmail` is set)

- **Vulnerable** — first detected: immediate. Repeats weekly while still vulnerable.
- **Severely outdated** (1+ major versions behind) — first detected: immediate. Repeats monthly while still severe.
- **No email** when up to date.

## Disabling everything

Set `updates.tier` to `"off"`. No HTTP request will leave the instance.

## Privacy

The version check sends no telemetry. Etherpad fetches the public GitHub Releases API. The only metadata GitHub sees is the same as any other GitHub API client (your IP, User-Agent header).
```

- [ ] **Step 3: Update `CHANGELOG.md`**

Read the head of `CHANGELOG.md` and add (under the unreleased section, or create one):

```markdown
### Added

- New self-update subsystem (Tier 1: notify).
  - Periodic version check against GitHub Releases (`updates.tier`, default `"notify"`; set `"off"` to disable).
  - Admin UI banner and dedicated update page when a new release is available.
  - Pad-side discreet badge only when running a severely-outdated or flagged-vulnerable version (no version string is leaked).
  - Optional escalating email nudges via top-level `adminEmail` setting.
```

- [ ] **Step 4: Commit**

```bash
git add doc/admin/updates.md CHANGELOG.md
git commit -m "docs(updater): document tier-1 updates and adminEmail settings"
```

---

## Task 17: Smoke test on a real instance

A short manual checklist before opening the PR. Each step you tick off here verifies a path the unit tests can't.

- [ ] **Step 1: Boot Etherpad locally**

```bash
cd /home/jose/etherpad/etherpad-lite && pnpm dev
```

Wait for `Server listening on port 9001`.

- [ ] **Step 2: Verify boot logs include the updater line**

In the dev output you should see `updater: install method = git, tier = notify`.

- [ ] **Step 3: Hit the public endpoint**

```bash
curl -s http://localhost:9001/api/version-status
```

Expected: `{"outdated":null}` (or `severe`/`vulnerable` if the test data is configured that way).

- [ ] **Step 4: Hit the admin endpoint without auth**

```bash
curl -i http://localhost:9001/admin/update/status
```

Expected: HTTP 401 (auth required).

- [ ] **Step 5: Hit the admin endpoint with auth**

```bash
curl -s -u admin:changeme http://localhost:9001/admin/update/status | head
```

(Adjust credentials to your local `settings.json`.) Expected: JSON with `currentVersion`, `latest`, `installMethod`, `tier`, `policy`.

- [ ] **Step 6: Open `/admin` in a browser**

Verify the new "Etherpad updates" nav link is visible. Click it; confirm the page renders the current version.

- [ ] **Step 7: Open a pad in a browser**

Verify there is no badge by default (the running version equals latest). Then in DevTools, intercept `/api/version-status` and return `{"outdated":"severe"}`; reload the pad; verify the badge appears in the bottom-right corner.

- [ ] **Step 8: Force a vulnerable test**

Edit `var/update-state.json` to add a `vulnerableBelow` entry whose threshold is above the running version. Reload the pad; confirm the badge text switches to the vulnerable copy.

- [ ] **Step 9: Confirm `tier: "off"` disables everything**

Set `updates.tier` to `"off"` in `settings.json`, restart, and confirm `curl /api/version-status` still works (cached value) but no GitHub request fires (look at the dev console logs).

---

## Task 18: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push fork feat/auto-update-tier1
```

- [ ] **Step 2: Create the PR via gh against `ether/etherpad-lite:develop`**

```bash
gh pr create \
  --repo ether/etherpad-lite \
  --base develop \
  --head johnmclear:feat/auto-update-tier1 \
  --title "feat(updater): tier 1 — notify admin and pad users of available updates" \
  --body "$(cat <<'EOF'
## Summary

Ships **Tier 1** of the four-tier auto-update design (spec: `docs/superpowers/specs/2026-04-25-auto-update-design.md`).

- Periodic poll of GitHub Releases (default 6h), cached on disk at `var/update-state.json`.
- Admin UI banner + read-only `/update` page.
- Public `/api/version-status` endpoint and pad-side footer badge — only renders when severely outdated or running a flagged-vulnerable version. Never leaks the running version string.
- Escalating email nudges via new top-level `adminEmail` setting.
- New `updates.*` settings block; default `tier: "notify"`. Set to `"off"` to disable entirely.
- Tier 1 contains **no execution code**. PRs 2–4 build on this foundation.

## Settings

`updates.tier` (default `"notify"`), `updates.checkIntervalHours`, `updates.githubRepo`, `adminEmail` — all optional. See `doc/admin/updates.md`.

## Test plan

- [x] vitest unit tests for `versionCompare`, `state`, `InstallMethodDetector`, `UpdatePolicy`, `VersionChecker`, `Notifier`
- [x] mocha integration tests for `/admin/update/status` and `/api/version-status`
- [x] Playwright admin spec — banner + page render
- [x] Playwright pad spec — badge visibility on `null` / `severe` / `vulnerable`
- [x] Manual smoke (real boot, real curl, real browser)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Post `/review` comment to trigger Qodo**

```bash
gh pr comment <PR-number> --body "/review"
```

- [ ] **Step 4: Confirm CI is green**

```bash
gh pr checks <PR-number>
```

If anything fails, fix the underlying issue and push (do NOT use `--no-verify`).

---

## Plan self-review

Done at write time:

- **Spec coverage:** every PR-1 scope item from the spec maps to a task — VersionChecker (Task 6), InstallMethodDetector (Task 4), UpdatePolicy (Task 5), state (Task 3), Notifier (Task 7), `updateStatus.ts` routes (Task 10), settings additions (Task 8), admin UI (Task 13), pad badge (Task 12), tests (Tasks 2-15), CHANGELOG/docs (Task 16). The spec's "PR 1: Test coverage gates" row (VersionChecker, InstallMethodDetector, UpdatePolicy, Notifier unit + status endpoint API + banner Playwright + pad badge Playwright) is all covered.
- **Placeholder scan:** no TBDs, no "implement later," no "similar to Task N" — every step has the actual code or command.
- **Type / name consistency:** `evaluatePolicy`, `checkLatestRelease`, `decideEmails`, `detectInstallMethod`, `loadState`/`saveState`, `getCurrentState`, `getDetectedInstallMethod` — used consistently across tasks. `UpdateState` shape matches between `types.ts`, `state.ts`, and the integration test. `EMPTY_STATE` is exported from `types.ts` and re-exported from `state.ts` as `EMPTY_STATE_FOR_TESTS` for clarity at call sites.

## Out of scope (deferred to PR 2)

- `UpdateExecutor` (git fetch/checkout, pnpm install, build:ui, exit 75)
- `RollbackHandler` (boot-time health check, crash-loop guard, terminal `rollback-failed`)
- `SessionDrainer` (60s broadcast)
- `var/update.lock`
- Tag signature verification + trusted-keys
- `POST /admin/update/apply`, `/cancel`, `/acknowledge`, `GET /admin/update/log`
- Apply button in admin UI
- Real SMTP wiring for the email path (PR 1 logs "would send" — connecting nodemailer or relying on a future plugin lands with PR 2)

These will be planned in `2026-04-25-auto-update-pr2-manual.md` after PR 1 lands and we know the actual file paths.
