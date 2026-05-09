# /release-review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/release-review` slash command — a three-phase orchestrator (deterministic tools sweep + 4 parallel AI subsystem sweeps + interactive auto-triage walkthrough) for full-codebase periodic reviews of Etherpad.

**Architecture:** Pure-function TypeScript helpers in `src/node/utils/releaseReview/` handle deterministic logic (fingerprinting, YAML suppression, aggregation, triage, summary writing). A CLI entry point (`cli.ts`) exposes them for invocation from a markdown slash command. The slash command is a prompt file at `.claude/commands/release-review.md` that orchestrates: subagent dispatches for the AI/tool work, CLI invocations for the deterministic work, main-context interaction for the live walkthrough.

**Tech Stack:** TypeScript (strict mode, CommonJS, mocha+tsx test runner already wired in `src/package.json`). YAML via `js-yaml` (already a transitive dep — verify in Task 3). Hashing via Node's `crypto` module. No new package dependencies should be required; if any are, use a separate task to add them.

**Spec:** `docs/superpowers/specs/2026-05-09-release-review-design.md` (read before starting; this plan implements it).

**Key conventions:**
- All helper modules go in `src/node/utils/releaseReview/`
- All tests go in `src/tests/backend/specs/releaseReview-utils.ts` (single file, multiple `describe` blocks — runs under `pnpm run test-utils` for fast feedback, 5s timeout)
- Use `import {strict as assert} from 'assert';` per existing pattern
- Use `describe(__filename, function () { ... })` per existing pattern
- Commit after each task completes with passing tests

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/node/utils/releaseReview/types.ts` | Shared TypeScript interfaces: `Finding`, `Severity`, `Category`, `SuppressionEntry`, `TriageBuckets` |
| `src/node/utils/releaseReview/fingerprint.ts` | `computeFingerprint(ruleId, file, line, contextLines)` — sha256 of normalized inputs |
| `src/node/utils/releaseReview/suppression.ts` | `loadSuppression(path)`, `appendSuppression(path, entry)` — read/write `known-findings.yml`; throws on malformed YAML |
| `src/node/utils/releaseReview/aggregate.ts` | `aggregate(findingArrays, suppressionEntries, severityFloor)` — merge, dedupe by fingerprint, filter by suppression + severity, sort |
| `src/node/utils/releaseReview/triage.ts` | `classify(findings)` — partition into Fix-now / Issue / Suppress buckets via heuristics |
| `src/node/utils/releaseReview/summary.ts` | `writeSummary(runId, decisions, outputPath)` — emit `<version>-summary.md` |
| `src/node/utils/releaseReview/runDir.ts` | `nextRunId(baseDir)`, `ensureRunDir(runId)` — run-id generation and dir scaffolding |
| `src/node/utils/releaseReview/cli.ts` | Single CLI entry point dispatching to the above; `tsx src/.../cli.ts <command>` |
| `src/tests/backend/specs/releaseReview-utils.ts` | All unit tests; one file with multiple `describe` blocks |
| `src/tests/backend/fixtures/releaseReview/` | Synthetic findings JSON, sample YAML, etc. |
| `.claude/commands/release-review.md` | Slash command (markdown prompt) |
| `docs/reviews/README.md` | Operator docs: when to run, how to triage, smoke test |
| `docs/reviews/known-findings.yml` | Suppression file (starts with header comment, empty `findings: []`) |
| `docs/reviews/prompts/tools.md` | Phase 1 subagent prompt |
| `docs/reviews/prompts/auth-sessions.md` | Phase 2 subagent prompt |
| `docs/reviews/prompts/realtime-api.md` | Phase 2 subagent prompt |
| `docs/reviews/prompts/pad-changeset.md` | Phase 2 subagent prompt |
| `docs/reviews/prompts/db-supply.md` | Phase 2 subagent prompt |

---

## Task 1: Scaffold directories, empty files, README skeleton

Creates the directory layout and inert starter files. No code, no tests yet — just structure so subsequent tasks have somewhere to land.

**Files:**
- Create: `src/node/utils/releaseReview/.gitkeep`
- Create: `src/tests/backend/fixtures/releaseReview/.gitkeep`
- Create: `docs/reviews/README.md`
- Create: `docs/reviews/known-findings.yml`
- Create: `docs/reviews/prompts/.gitkeep`

- [ ] **Step 1: Create directories and gitkeep placeholders**

```bash
mkdir -p src/node/utils/releaseReview
mkdir -p src/tests/backend/fixtures/releaseReview
mkdir -p docs/reviews/prompts
touch src/node/utils/releaseReview/.gitkeep
touch src/tests/backend/fixtures/releaseReview/.gitkeep
touch docs/reviews/prompts/.gitkeep
```

- [ ] **Step 2: Create the empty suppression file**

Write `docs/reviews/known-findings.yml`:

```yaml
# /release-review suppression file.
# Entries are appended automatically by `/release-review` when the user
# triages a finding as wontfix / accepted-risk / deferred.
#
# Manual edits are supported for re-triaging:
#   - Remove an entry to make the finding resurface in the next run.
#   - Change `status` to reclassify.
#   - DO NOT hand-edit `fingerprint` — it must come from a real run.
#
# See docs/reviews/README.md for the schema and triage workflow.

findings: []
```

- [ ] **Step 3: Create README skeleton**

Write `docs/reviews/README.md`:

```markdown
# /release-review

Periodic full-codebase review for Etherpad releases. See
`docs/superpowers/specs/2026-05-09-release-review-design.md` for the
design rationale.

This README is fleshed out in Task 14. For now it exists so the
directory has a landing page and the slash command can link to it.
```

- [ ] **Step 4: Verify structure**

Run: `find docs/reviews src/node/utils/releaseReview src/tests/backend/fixtures/releaseReview -type f`
Expected output (order-insensitive):
```
docs/reviews/README.md
docs/reviews/known-findings.yml
docs/reviews/prompts/.gitkeep
src/node/utils/releaseReview/.gitkeep
src/tests/backend/fixtures/releaseReview/.gitkeep
```

- [ ] **Step 5: Commit**

```bash
git add docs/reviews src/node/utils/releaseReview src/tests/backend/fixtures/releaseReview
git commit -m "chore(reviews): scaffold /release-review directory structure"
```

---

## Task 2: Shared types module

Defines the TypeScript interfaces used by every other module. No runtime code, no tests of its own — types are exercised by the modules and tests that follow.

**Files:**
- Create: `src/node/utils/releaseReview/types.ts`

- [ ] **Step 1: Write the types module**

Write `src/node/utils/releaseReview/types.ts`:

```typescript
'use strict';

export type Severity = 'high' | 'medium' | 'low' | 'info';

export type Category = 'cve' | 'bug' | 'perf' | 'lint' | 'supply-chain';

export type SuppressionStatus = 'wontfix' | 'accepted-risk' | 'deferred';

export type Bucket = 'fix-now' | 'issue' | 'suppress';

/** A single finding emitted by Phase 1 (tool sweep) or Phase 2 (AI sweep). */
export interface Finding {
  /** Producing tool or subagent name (e.g., "semgrep", "auth-sessions"). */
  source: string;
  /** Stable hash; see fingerprint.ts. */
  fingerprint: string;
  severity: Severity;
  category: Category;
  /** Repo-relative path. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** Tool rule ID (e.g., "semgrep.javascript.audit.detect-insecure-randomness")
   *  or AI-assigned slug (e.g., "auth-sessions.timing-attack-equality"). */
  ruleId: string;
  message: string;
  /** Optional remediation hint shown to the user during walkthrough. */
  remediationHint?: string;
  /** First run-id this fingerprint was seen in (null if new this run). */
  firstSeen?: string | null;
}

/** A single entry in docs/reviews/known-findings.yml. */
export interface SuppressionEntry {
  fingerprint: string;
  status: SuppressionStatus;
  ruleId?: string;
  file?: string;
  line?: number;
  decidedAt: string;        // ISO date YYYY-MM-DD
  decidedInRun: string;     // run-id
  rationale: string;
  /** Required when status === 'deferred'. */
  targetRelease?: string;
}

/** Result of triage classification. */
export interface TriageBuckets {
  fixNow: Finding[];
  issue: Finding[];
  suppress: Finding[];
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm run ts-check`
Expected: PASS (0 errors). The module has no runtime code so this only validates type definitions are well-formed.

- [ ] **Step 3: Commit**

```bash
git add src/node/utils/releaseReview/types.ts
git commit -m "feat(reviews): add shared types for /release-review helpers"
```

---

## Task 3: Fingerprint module (TDD)

Computes a stable hash for each finding so suppression survives line-shift drift. Hash inputs: `ruleId`, `file`, and a normalized 5-line context window around the finding. Whitespace is stripped per line; identifiers preserved. Line-shifting alone does not change the hash; logic changes do.

**Files:**
- Create: `src/node/utils/releaseReview/fingerprint.ts`
- Create: `src/tests/backend/specs/releaseReview-utils.ts` (initial — extended in later tasks)
- Create: `src/tests/backend/fixtures/releaseReview/sample-source.ts`

- [ ] **Step 1: Write failing tests**

Create `src/tests/backend/fixtures/releaseReview/sample-source.ts`:

```typescript
// Fixture: a sample source file used for fingerprint stability tests.
// Do NOT edit the body of this file casually — fingerprint tests assert
// specific content around line 5 and line 9.

export const greet = (name: string): string => {
  // line 5 (1-indexed): the equality check below is the seeded "finding"
  if (name == null) return 'hello stranger';
  return `hello ${name}`;
};

export const farewell = (name: string): string => {
  return `bye ${name}`;
};
```

Create `src/tests/backend/specs/releaseReview-utils.ts`:

```typescript
'use strict';

import {strict as assert} from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {computeFingerprint} from '../../../node/utils/releaseReview/fingerprint';

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'releaseReview');
const SAMPLE = path.join(FIXTURE_DIR, 'sample-source.ts');

const readLines = (file: string): string[] => fs.readFileSync(file, 'utf8').split('\n');

describe(__filename, function () {
  describe('computeFingerprint', function () {
    it('returns a 64-char lowercase hex sha256', function () {
      const lines = readLines(SAMPLE);
      const fp = computeFingerprint('rule.x', SAMPLE, 6, lines);
      assert.match(fp, /^[0-9a-f]{64}$/);
    });

    it('is stable when whitespace-only lines shift around the finding', function () {
      const lines = readLines(SAMPLE);
      const fpA = computeFingerprint('rule.x', SAMPLE, 6, lines);
      // Insert a blank line above the finding; renumber so the same logical
      // line content is now at line 7.
      const shifted = ['', ...lines];
      const fpB = computeFingerprint('rule.x', SAMPLE, 7, shifted);
      assert.equal(fpA, fpB);
    });

    it('changes when the finding line content changes', function () {
      const lines = readLines(SAMPLE);
      const fpA = computeFingerprint('rule.x', SAMPLE, 6, lines);
      // Mutate the finding line itself (the equality check).
      const mutated = lines.slice();
      mutated[5] = '  if (name === undefined) return \'hello stranger\';';
      const fpB = computeFingerprint('rule.x', SAMPLE, 6, mutated);
      assert.notEqual(fpA, fpB);
    });

    it('changes when the rule id changes', function () {
      const lines = readLines(SAMPLE);
      const fpA = computeFingerprint('rule.x', SAMPLE, 6, lines);
      const fpB = computeFingerprint('rule.y', SAMPLE, 6, lines);
      assert.notEqual(fpA, fpB);
    });

    it('changes when the file path changes', function () {
      const lines = readLines(SAMPLE);
      const fpA = computeFingerprint('rule.x', '/a/b.ts', 6, lines);
      const fpB = computeFingerprint('rule.x', '/a/c.ts', 6, lines);
      assert.notEqual(fpA, fpB);
    });

    it('handles edge: finding line near start of file (no 2 lines above)', function () {
      const lines = readLines(SAMPLE);
      const fp = computeFingerprint('rule.x', SAMPLE, 1, lines);
      assert.match(fp, /^[0-9a-f]{64}$/);
    });

    it('handles edge: finding line near end of file (no 2 lines below)', function () {
      const lines = readLines(SAMPLE);
      const fp = computeFingerprint('rule.x', SAMPLE, lines.length, lines);
      assert.match(fp, /^[0-9a-f]{64}$/);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: FAIL — `computeFingerprint` is not defined / cannot find module `fingerprint`.

- [ ] **Step 3: Implement the module**

Write `src/node/utils/releaseReview/fingerprint.ts`:

```typescript
'use strict';

import {createHash} from 'crypto';

/**
 * Compute a stable fingerprint for a finding.
 *
 * Inputs:
 *   - ruleId: tool rule or AI rule slug
 *   - file:   repo-relative path (or absolute — caller decides; just be consistent)
 *   - line:   1-indexed line number of the finding
 *   - lines:  full file contents split by '\n'; used to extract a 5-line window
 *             centered on `line` (2 above + the line + 2 below; clamped at edges)
 *
 * Each context line is trimmed of leading/trailing whitespace before hashing,
 * so reformatting noise doesn't break suppression. Identifiers and structure
 * are preserved, so a real logic edit does break it.
 */
export const computeFingerprint = (
  ruleId: string,
  file: string,
  line: number,
  lines: readonly string[],
): string => {
  const idx = line - 1;
  const start = Math.max(0, idx - 2);
  const end = Math.min(lines.length, idx + 3);
  const context = lines.slice(start, end).map((l) => l.trim()).join('\n');
  const payload = `${ruleId}::${file}::${context}`;
  return createHash('sha256').update(payload).digest('hex');
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: PASS — all 7 fingerprint tests green.

- [ ] **Step 5: Commit**

```bash
git add src/node/utils/releaseReview/fingerprint.ts src/tests/backend/specs/releaseReview-utils.ts src/tests/backend/fixtures/releaseReview/sample-source.ts
git commit -m "feat(reviews): add fingerprint helper with whitespace-stable hashing"
```

---

## Task 4: Suppression file module (TDD)

Loads, validates, and appends entries to `docs/reviews/known-findings.yml`. Malformed YAML aborts the session with a clear error pointing at the bad entry — silent skipping would let a corrupt file hide real issues.

Note: `js-yaml` is a transitive dep of many tools but verify availability in Step 1; if missing, install it as a direct dep before continuing.

**Files:**
- Create: `src/node/utils/releaseReview/suppression.ts`
- Modify: `src/tests/backend/specs/releaseReview-utils.ts` (append a new `describe` block)
- Create: `src/tests/backend/fixtures/releaseReview/suppression-valid.yml`
- Create: `src/tests/backend/fixtures/releaseReview/suppression-malformed.yml`
- Create: `src/tests/backend/fixtures/releaseReview/suppression-bad-shape.yml`

- [ ] **Step 1: Verify js-yaml is available**

Run: `pnpm --filter ep_etherpad-lite list js-yaml 2>&1 | head -5`

If it lists a version, proceed. If empty, run:
```bash
pnpm --filter ep_etherpad-lite add js-yaml
pnpm --filter ep_etherpad-lite add -D @types/js-yaml
```
and commit the lockfile change as a separate prep commit before continuing.

- [ ] **Step 2: Create test fixtures**

Write `src/tests/backend/fixtures/releaseReview/suppression-valid.yml`:

```yaml
findings:
  - fingerprint: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    status: wontfix
    ruleId: semgrep.test.rule
    file: src/x.ts
    line: 14
    decidedAt: 2026-05-09
    decidedInRun: run-2026-05-09-1
    rationale: "Used only for non-security pad IDs."
  - fingerprint: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    status: deferred
    decidedAt: 2026-05-09
    decidedInRun: run-2026-05-09-1
    rationale: "Tracked in #7712."
    targetRelease: "2.9.0"
```

Write `src/tests/backend/fixtures/releaseReview/suppression-malformed.yml`:

```yaml
findings:
  - fingerprint: aaaa
    status: wontfix
    rationale: "unterminated string
```

Write `src/tests/backend/fixtures/releaseReview/suppression-bad-shape.yml`:

```yaml
findings:
  - status: wontfix
    rationale: "missing fingerprint and other required fields"
```

- [ ] **Step 3: Append failing tests to releaseReview-utils.ts**

Inside the existing `describe(__filename, function () { ... })` in `src/tests/backend/specs/releaseReview-utils.ts`, ABOVE the closing brace of the outer describe, add:

```typescript
  describe('suppression', function () {
    const valid = path.join(FIXTURE_DIR, 'suppression-valid.yml');
    const malformed = path.join(FIXTURE_DIR, 'suppression-malformed.yml');
    const badShape = path.join(FIXTURE_DIR, 'suppression-bad-shape.yml');

    it('loads a well-formed file', function () {
      const {loadSuppression} = require('../../../node/utils/releaseReview/suppression');
      const entries = loadSuppression(valid);
      assert.equal(entries.length, 2);
      assert.equal(entries[0].status, 'wontfix');
      assert.equal(entries[1].targetRelease, '2.9.0');
    });

    it('returns empty array if file does not exist', function () {
      const {loadSuppression} = require('../../../node/utils/releaseReview/suppression');
      const entries = loadSuppression(path.join(FIXTURE_DIR, 'does-not-exist.yml'));
      assert.deepEqual(entries, []);
    });

    it('throws on malformed YAML with file path in error', function () {
      const {loadSuppression} = require('../../../node/utils/releaseReview/suppression');
      assert.throws(() => loadSuppression(malformed), (err: Error) => {
        return err.message.includes('suppression-malformed.yml');
      });
    });

    it('throws on entries missing required fields', function () {
      const {loadSuppression} = require('../../../node/utils/releaseReview/suppression');
      assert.throws(() => loadSuppression(badShape), /fingerprint/);
    });

    it('throws on deferred entry without targetRelease', function () {
      const tmp = path.join(FIXTURE_DIR, '_tmp-deferred-no-target.yml');
      fs.writeFileSync(tmp, [
        'findings:',
        '  - fingerprint: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        '    status: deferred',
        '    decidedAt: 2026-05-09',
        '    decidedInRun: run-x',
        '    rationale: "no target"',
      ].join('\n'));
      try {
        const {loadSuppression} = require('../../../node/utils/releaseReview/suppression');
        assert.throws(() => loadSuppression(tmp), /targetRelease/);
      } finally {
        fs.unlinkSync(tmp);
      }
    });

    it('appends an entry to a fresh file with header preserved', function () {
      const tmp = path.join(FIXTURE_DIR, '_tmp-append.yml');
      fs.writeFileSync(tmp, '# header comment\n\nfindings: []\n');
      try {
        const {appendSuppression} = require('../../../node/utils/releaseReview/suppression');
        appendSuppression(tmp, {
          fingerprint: 'd'.repeat(64),
          status: 'accepted-risk',
          decidedAt: '2026-05-09',
          decidedInRun: 'run-x',
          rationale: 'baseline',
        });
        const written = fs.readFileSync(tmp, 'utf8');
        assert.match(written, /# header comment/);
        assert.match(written, /accepted-risk/);
        assert.match(written, /baseline/);
        const {loadSuppression} = require('../../../node/utils/releaseReview/suppression');
        assert.equal(loadSuppression(tmp).length, 1);
      } finally {
        fs.unlinkSync(tmp);
      }
    });
  });
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: FAIL — `suppression` module not found.

- [ ] **Step 5: Implement suppression.ts**

Write `src/node/utils/releaseReview/suppression.ts`:

```typescript
'use strict';

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import {SuppressionEntry, SuppressionStatus} from './types';

const VALID_STATUSES: ReadonlySet<SuppressionStatus> =
  new Set(['wontfix', 'accepted-risk', 'deferred']);

const validateEntry = (raw: any, filePath: string, index: number): SuppressionEntry => {
  const where = `${filePath} entry #${index}`;
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${where}: expected object, got ${typeof raw}`);
  }
  for (const field of ['fingerprint', 'status', 'decidedAt', 'decidedInRun', 'rationale']) {
    if (typeof raw[field] !== 'string' || raw[field].length === 0) {
      throw new Error(`${where}: missing or empty required field '${field}'`);
    }
  }
  if (!VALID_STATUSES.has(raw.status)) {
    throw new Error(`${where}: invalid status '${raw.status}' (expected wontfix|accepted-risk|deferred)`);
  }
  if (raw.status === 'deferred' && typeof raw.targetRelease !== 'string') {
    throw new Error(`${where}: status 'deferred' requires 'targetRelease'`);
  }
  return raw as SuppressionEntry;
};

/**
 * Load and validate a known-findings.yml file.
 * Returns [] if the file is absent. Throws with file context on malformed YAML
 * or shape errors — never silently drops bad entries.
 */
export const loadSuppression = (filePath: string): SuppressionEntry[] => {
  if (!fs.existsSync(filePath)) return [];
  let parsed: any;
  try {
    parsed = yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (e: any) {
    throw new Error(`Failed to parse YAML at ${filePath}: ${e.message}`);
  }
  if (parsed == null) return [];
  if (typeof parsed !== 'object' || !Array.isArray(parsed.findings)) {
    throw new Error(`${filePath}: expected top-level shape { findings: [...] }`);
  }
  return parsed.findings.map((raw: any, i: number) => validateEntry(raw, filePath, i));
};

/**
 * Append a single entry to an existing known-findings.yml file.
 * Preserves any leading comments / blank lines before the `findings:` key by
 * re-emitting only the findings list with the new entry appended.
 */
export const appendSuppression = (filePath: string, entry: SuppressionEntry): void => {
  const existing = loadSuppression(filePath);
  existing.push(entry);
  // Preserve any header comments by reading the original file up to (but not
  // including) the `findings:` line, then re-emit findings.
  const original = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = original.split('\n');
  const findingsIdx = lines.findIndex((l) => /^findings\s*:/.test(l));
  const header = findingsIdx >= 0 ? lines.slice(0, findingsIdx).join('\n') : '';
  const body = yaml.dump({findings: existing}, {lineWidth: 100, noRefs: true});
  const out = (header.length > 0 ? header.replace(/\n+$/, '') + '\n\n' : '') + body;
  fs.writeFileSync(filePath, out);
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: PASS — all 6 suppression tests + the 7 fingerprint tests from Task 3 are green.

- [ ] **Step 7: Commit**

```bash
git add src/node/utils/releaseReview/suppression.ts src/tests/backend/specs/releaseReview-utils.ts src/tests/backend/fixtures/releaseReview/suppression-*.yml
git commit -m "feat(reviews): add known-findings.yml load/append with validation"
```

---

## Task 5: Aggregation/dedupe module (TDD)

Merges findings from all five sources, dedupes by fingerprint (highest severity wins; sources unioned), filters by suppression list, drops below severity floor, and sorts.

**Files:**
- Create: `src/node/utils/releaseReview/aggregate.ts`
- Modify: `src/tests/backend/specs/releaseReview-utils.ts` (append a new `describe` block)

- [ ] **Step 1: Append failing tests**

Inside the outer `describe(__filename, ...)` in `releaseReview-utils.ts`, add:

```typescript
  describe('aggregate', function () {
    const mkFinding = (over: any) => ({
      source: 'semgrep',
      fingerprint: 'x'.repeat(64),
      severity: 'medium',
      category: 'bug',
      file: 'src/a.ts',
      line: 1,
      ruleId: 'r',
      message: 'm',
      ...over,
    });

    it('drops findings below severity floor', function () {
      const {aggregate} = require('../../../node/utils/releaseReview/aggregate');
      const out = aggregate(
        [[mkFinding({severity: 'low'}), mkFinding({severity: 'medium', fingerprint: 'a'.repeat(64)})]],
        [],
        'medium',
      );
      assert.equal(out.length, 1);
      assert.equal(out[0].severity, 'medium');
    });

    it('drops findings whose fingerprint appears in suppression with wontfix or accepted-risk', function () {
      const {aggregate} = require('../../../node/utils/releaseReview/aggregate');
      const fp = 'a'.repeat(64);
      const out = aggregate(
        [[mkFinding({fingerprint: fp, severity: 'high'})]],
        [{fingerprint: fp, status: 'wontfix', decidedAt: 'd', decidedInRun: 'r', rationale: 'r'}],
        'medium',
      );
      assert.equal(out.length, 0);
    });

    it('keeps deferred findings but annotates them', function () {
      const {aggregate} = require('../../../node/utils/releaseReview/aggregate');
      const fp = 'a'.repeat(64);
      const out = aggregate(
        [[mkFinding({fingerprint: fp, severity: 'high'})]],
        [{fingerprint: fp, status: 'deferred', decidedAt: 'd', decidedInRun: 'old-run', rationale: 'r', targetRelease: '2.9.0'}],
        'medium',
      );
      assert.equal(out.length, 1);
      assert.equal(out[0].firstSeen, 'old-run');
    });

    it('dedupes by fingerprint, keeping highest severity', function () {
      const {aggregate} = require('../../../node/utils/releaseReview/aggregate');
      const fp = 'a'.repeat(64);
      const out = aggregate(
        [
          [mkFinding({fingerprint: fp, severity: 'medium', source: 'semgrep'})],
          [mkFinding({fingerprint: fp, severity: 'high', source: 'auth-sessions'})],
        ],
        [],
        'medium',
      );
      assert.equal(out.length, 1);
      assert.equal(out[0].severity, 'high');
      assert.match(out[0].source, /semgrep/);
      assert.match(out[0].source, /auth-sessions/);
    });

    it('sorts by severity (high first) then category (cve > bug > perf > supply-chain)', function () {
      const {aggregate} = require('../../../node/utils/releaseReview/aggregate');
      const out = aggregate(
        [[
          mkFinding({fingerprint: 'a'.repeat(64), severity: 'medium', category: 'bug'}),
          mkFinding({fingerprint: 'b'.repeat(64), severity: 'high', category: 'perf'}),
          mkFinding({fingerprint: 'c'.repeat(64), severity: 'high', category: 'cve'}),
          mkFinding({fingerprint: 'd'.repeat(64), severity: 'medium', category: 'cve'}),
        ]],
        [],
        'medium',
      );
      assert.deepEqual(out.map((f: any) => f.fingerprint[0]), ['c', 'b', 'd', 'a']);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: FAIL — `aggregate` module not found.

- [ ] **Step 3: Implement aggregate.ts**

Write `src/node/utils/releaseReview/aggregate.ts`:

```typescript
'use strict';

import {Finding, Severity, Category, SuppressionEntry} from './types';

const SEVERITY_RANK: Record<Severity, number> = {high: 3, medium: 2, low: 1, info: 0};
const CATEGORY_RANK: Record<Category, number> =
  {cve: 4, bug: 3, perf: 2, 'supply-chain': 1, lint: 0};

const meetsFloor = (sev: Severity, floor: Severity): boolean =>
  SEVERITY_RANK[sev] >= SEVERITY_RANK[floor];

/**
 * Merge findings from N sources, applying suppression and severity floor.
 * Dedupe by fingerprint: highest severity wins, sources are unioned.
 * Sort: severity desc, then category rank desc.
 */
export const aggregate = (
  findingArrays: Finding[][],
  suppression: SuppressionEntry[],
  severityFloor: Severity,
): Finding[] => {
  const suppressed = new Map<string, SuppressionEntry>();
  for (const e of suppression) suppressed.set(e.fingerprint, e);

  const byFingerprint = new Map<string, Finding>();
  for (const arr of findingArrays) {
    for (const f of arr) {
      const sup = suppressed.get(f.fingerprint);
      if (sup && (sup.status === 'wontfix' || sup.status === 'accepted-risk')) continue;
      if (!meetsFloor(f.severity, severityFloor)) continue;
      const annotated: Finding = sup && sup.status === 'deferred'
        ? {...f, firstSeen: sup.decidedInRun}
        : f;
      const existing = byFingerprint.get(annotated.fingerprint);
      if (!existing) {
        byFingerprint.set(annotated.fingerprint, annotated);
      } else {
        const winner = SEVERITY_RANK[annotated.severity] > SEVERITY_RANK[existing.severity]
          ? annotated
          : existing;
        const sources = new Set([existing.source, annotated.source].flatMap((s) => s.split(',')));
        byFingerprint.set(annotated.fingerprint, {
          ...winner,
          source: [...sources].join(','),
        });
      }
    }
  }

  return [...byFingerprint.values()].sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;
    return CATEGORY_RANK[b.category] - CATEGORY_RANK[a.category];
  });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: PASS — 5 aggregate tests plus all earlier tests green.

- [ ] **Step 5: Commit**

```bash
git add src/node/utils/releaseReview/aggregate.ts src/tests/backend/specs/releaseReview-utils.ts
git commit -m "feat(reviews): add finding aggregation with dedupe and severity floor"
```

---

## Task 6: Auto-triage classifier (TDD)

Partitions Medium+ findings into Fix-now / Issue / Suppress buckets via heuristics. **Heuristics, not rules** — this is best-effort; the user always confirms before anything is applied.

Heuristics:
- **Fix-now**: single-file change, has `remediationHint`, severity in {high, medium}, ruleId is in a known small-fix list (e.g. semgrep `detect-insecure-randomness`, eslint warning categories)
- **Suppress**: low-confidence patterns — ruleId matches known false-positive prefixes (configured list); category is `lint`; or severity is exactly `medium` AND source is a single tool with no `remediationHint`
- **Issue**: everything else (cross-file or design tradeoff likely)

**Files:**
- Create: `src/node/utils/releaseReview/triage.ts`
- Modify: `src/tests/backend/specs/releaseReview-utils.ts` (append)

- [ ] **Step 1: Append failing tests**

```typescript
  describe('triage', function () {
    const mkFinding = (over: any) => ({
      source: 'semgrep',
      fingerprint: 'x'.repeat(64),
      severity: 'medium',
      category: 'bug',
      file: 'src/a.ts',
      line: 1,
      ruleId: 'r',
      message: 'm',
      ...over,
    });

    it('classifies a single-file finding with remediationHint as fix-now', function () {
      const {classify} = require('../../../node/utils/releaseReview/triage');
      const buckets = classify([
        mkFinding({remediationHint: 'replace == with ===', severity: 'high'}),
      ]);
      assert.equal(buckets.fixNow.length, 1);
      assert.equal(buckets.issue.length, 0);
      assert.equal(buckets.suppress.length, 0);
    });

    it('classifies a category=lint finding as suppress', function () {
      const {classify} = require('../../../node/utils/releaseReview/triage');
      const buckets = classify([mkFinding({category: 'lint'})]);
      assert.equal(buckets.suppress.length, 1);
    });

    it('classifies medium-severity tool finding without remediation as suppress', function () {
      const {classify} = require('../../../node/utils/releaseReview/triage');
      const buckets = classify([mkFinding({severity: 'medium', source: 'semgrep'})]);
      assert.equal(buckets.suppress.length, 1);
    });

    it('classifies a high-severity AI finding without remediation as issue (needs design)', function () {
      const {classify} = require('../../../node/utils/releaseReview/triage');
      const buckets = classify([mkFinding({severity: 'high', source: 'auth-sessions'})]);
      assert.equal(buckets.issue.length, 1);
    });

    it('returns disjoint buckets summing to input length', function () {
      const {classify} = require('../../../node/utils/releaseReview/triage');
      const findings = [
        mkFinding({fingerprint: 'a'.repeat(64), category: 'lint'}),
        mkFinding({fingerprint: 'b'.repeat(64), severity: 'high', remediationHint: 'fix it'}),
        mkFinding({fingerprint: 'c'.repeat(64), severity: 'high', source: 'pad-changeset'}),
      ];
      const buckets = classify(findings);
      assert.equal(
        buckets.fixNow.length + buckets.issue.length + buckets.suppress.length,
        findings.length,
      );
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: FAIL — `triage` module not found.

- [ ] **Step 3: Implement triage.ts**

Write `src/node/utils/releaseReview/triage.ts`:

```typescript
'use strict';

import {Finding, TriageBuckets} from './types';

const KNOWN_TOOL_SOURCES = new Set([
  'pnpm-audit', 'osv-scanner', 'semgrep', 'eslint', 'madge', 'depcheck',
]);

const isToolSource = (src: string): boolean =>
  src.split(',').some((s) => KNOWN_TOOL_SOURCES.has(s.trim()));

/**
 * Heuristic auto-triage. Best-effort; user always confirms.
 */
export const classify = (findings: readonly Finding[]): TriageBuckets => {
  const buckets: TriageBuckets = {fixNow: [], issue: [], suppress: []};
  for (const f of findings) {
    if (f.category === 'lint') {
      buckets.suppress.push(f);
      continue;
    }
    if (f.remediationHint && f.remediationHint.length > 0) {
      buckets.fixNow.push(f);
      continue;
    }
    // Medium tool-only finding without a hint: likely false-positive territory.
    if (f.severity === 'medium' && isToolSource(f.source)) {
      buckets.suppress.push(f);
      continue;
    }
    // Everything else needs human design work.
    buckets.issue.push(f);
  }
  return buckets;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: PASS — all triage tests + earlier tests green.

- [ ] **Step 5: Commit**

```bash
git add src/node/utils/releaseReview/triage.ts src/tests/backend/specs/releaseReview-utils.ts
git commit -m "feat(reviews): add heuristic auto-triage classifier"
```

---

## Task 7: Run-id and run-dir module (TDD)

Generates `run-YYYY-MM-DD-N` ids (N = next available for today) and creates the run directory under a configurable base (default `/tmp/release-review`).

**Files:**
- Create: `src/node/utils/releaseReview/runDir.ts`
- Modify: `src/tests/backend/specs/releaseReview-utils.ts` (append)

- [ ] **Step 1: Append failing tests**

```typescript
  describe('runDir', function () {
    const tmpBase = path.join(FIXTURE_DIR, '_tmp-runs');

    beforeEach(function () {
      if (fs.existsSync(tmpBase)) fs.rmSync(tmpBase, {recursive: true});
      fs.mkdirSync(tmpBase, {recursive: true});
    });
    after(function () {
      if (fs.existsSync(tmpBase)) fs.rmSync(tmpBase, {recursive: true});
    });

    it('generates run-id format run-YYYY-MM-DD-N starting at 1', function () {
      const {nextRunId} = require('../../../node/utils/releaseReview/runDir');
      const id = nextRunId(tmpBase, '2026-05-09');
      assert.equal(id, 'run-2026-05-09-1');
    });

    it('increments N when same-day runs already exist', function () {
      const {nextRunId} = require('../../../node/utils/releaseReview/runDir');
      fs.mkdirSync(path.join(tmpBase, 'run-2026-05-09-1'));
      fs.mkdirSync(path.join(tmpBase, 'run-2026-05-09-2'));
      const id = nextRunId(tmpBase, '2026-05-09');
      assert.equal(id, 'run-2026-05-09-3');
    });

    it('starts at 1 for a new day even if older days exist', function () {
      const {nextRunId} = require('../../../node/utils/releaseReview/runDir');
      fs.mkdirSync(path.join(tmpBase, 'run-2026-05-08-5'));
      const id = nextRunId(tmpBase, '2026-05-09');
      assert.equal(id, 'run-2026-05-09-1');
    });

    it('ensureRunDir creates the dir and returns the absolute path', function () {
      const {ensureRunDir} = require('../../../node/utils/releaseReview/runDir');
      const p = ensureRunDir(tmpBase, 'run-2026-05-09-1');
      assert.equal(fs.existsSync(p), true);
      assert.equal(p, path.join(tmpBase, 'run-2026-05-09-1'));
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: FAIL — `runDir` module not found.

- [ ] **Step 3: Implement runDir.ts**

Write `src/node/utils/releaseReview/runDir.ts`:

```typescript
'use strict';

import * as fs from 'fs';
import * as path from 'path';

const RUN_RE = /^run-(\d{4}-\d{2}-\d{2})-(\d+)$/;

/** Today's date as YYYY-MM-DD in the local timezone. */
export const todayIso = (): string => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Determine the next run-id for `date` (YYYY-MM-DD), based on existing run dirs
 * directly under `baseDir`. Returns "run-<date>-N" where N is the next free index
 * starting at 1 for a fresh day.
 */
export const nextRunId = (baseDir: string, date: string): string => {
  let maxN = 0;
  if (fs.existsSync(baseDir)) {
    for (const name of fs.readdirSync(baseDir)) {
      const m = RUN_RE.exec(name);
      if (m && m[1] === date) {
        const n = parseInt(m[2], 10);
        if (n > maxN) maxN = n;
      }
    }
  }
  return `run-${date}-${maxN + 1}`;
};

/** Create the run dir (idempotent) and return its absolute path. */
export const ensureRunDir = (baseDir: string, runId: string): string => {
  const p = path.join(baseDir, runId);
  fs.mkdirSync(p, {recursive: true});
  return p;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/node/utils/releaseReview/runDir.ts src/tests/backend/specs/releaseReview-utils.ts
git commit -m "feat(reviews): add run-id generation and run-dir helpers"
```

---

## Task 8: Summary writer (TDD)

Emits `docs/reviews/<version>-summary.md` at session end, listing run-id, finding counts by severity, and decisions taken.

**Files:**
- Create: `src/node/utils/releaseReview/summary.ts`
- Modify: `src/tests/backend/specs/releaseReview-utils.ts` (append)

- [ ] **Step 1: Append failing tests**

```typescript
  describe('summary', function () {
    const tmpDir = path.join(FIXTURE_DIR, '_tmp-summary');
    beforeEach(function () {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, {recursive: true});
      fs.mkdirSync(tmpDir, {recursive: true});
    });
    after(function () {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, {recursive: true});
    });

    it('writes a markdown file with run-id, version, counts, decisions', function () {
      const {writeSummary} = require('../../../node/utils/releaseReview/summary');
      const out = path.join(tmpDir, '2.8.0-summary.md');
      writeSummary({
        runId: 'run-2026-05-09-1',
        version: '2.8.0',
        counts: {high: 2, medium: 5},
        decisions: [
          {fingerprint: 'a'.repeat(64), action: 'fix', file: 'src/x.ts', ruleId: 'r1'},
          {fingerprint: 'b'.repeat(64), action: 'wontfix', file: 'src/y.ts', ruleId: 'r2', rationale: 'not exploitable'},
          {fingerprint: 'c'.repeat(64), action: 'issue', file: 'src/z.ts', ruleId: 'r3', issueUrl: 'https://github.com/ether/etherpad-lite/issues/9999'},
        ],
      }, out);
      const md = fs.readFileSync(out, 'utf8');
      assert.match(md, /run-2026-05-09-1/);
      assert.match(md, /2\.8\.0/);
      assert.match(md, /high.*2/i);
      assert.match(md, /medium.*5/i);
      assert.match(md, /src\/x\.ts/);
      assert.match(md, /not exploitable/);
      assert.match(md, /issues\/9999/);
    });

    it('handles a session with no decisions', function () {
      const {writeSummary} = require('../../../node/utils/releaseReview/summary');
      const out = path.join(tmpDir, 'empty-summary.md');
      writeSummary({
        runId: 'run-2026-05-09-2',
        version: '2.8.0',
        counts: {high: 0, medium: 0},
        decisions: [],
      }, out);
      const md = fs.readFileSync(out, 'utf8');
      assert.match(md, /no decisions/i);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: FAIL — `summary` module not found.

- [ ] **Step 3: Implement summary.ts**

Write `src/node/utils/releaseReview/summary.ts`:

```typescript
'use strict';

import * as fs from 'fs';

export type DecisionAction = 'fix' | 'issue' | 'wontfix' | 'accepted-risk' | 'deferred' | 'skip';

export interface Decision {
  fingerprint: string;
  action: DecisionAction;
  file: string;
  ruleId: string;
  rationale?: string;
  issueUrl?: string;
}

export interface SummaryInput {
  runId: string;
  version: string;
  counts: {high?: number; medium?: number; low?: number; info?: number};
  decisions: Decision[];
}

const ACTION_HEADINGS: Record<DecisionAction, string> = {
  fix: 'Fixed in this session',
  issue: 'Filed as GitHub issue',
  wontfix: 'Marked WONTFIX',
  'accepted-risk': 'Marked accepted-risk',
  deferred: 'Deferred',
  skip: 'Skipped (no decision)',
};

const groupBy = <T>(arr: T[], key: (t: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const t of arr) {
    const k = key(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  return m;
};

export const writeSummary = (input: SummaryInput, outputPath: string): void => {
  const lines: string[] = [];
  lines.push(`# /release-review summary — ${input.version}`);
  lines.push('');
  lines.push(`**Run:** \`${input.runId}\``);
  lines.push('');
  lines.push('## Finding counts');
  lines.push('');
  for (const sev of ['high', 'medium', 'low', 'info'] as const) {
    if (input.counts[sev] != null) lines.push(`- **${sev}**: ${input.counts[sev]}`);
  }
  lines.push('');
  lines.push('## Decisions');
  lines.push('');
  if (input.decisions.length === 0) {
    lines.push('_No decisions taken in this session._');
  } else {
    const groups = groupBy(input.decisions, (d) => d.action);
    for (const action of Object.keys(ACTION_HEADINGS) as DecisionAction[]) {
      const group = groups.get(action);
      if (!group || group.length === 0) continue;
      lines.push(`### ${ACTION_HEADINGS[action]}`);
      lines.push('');
      for (const d of group) {
        const issue = d.issueUrl ? ` ([#issue](${d.issueUrl}))` : '';
        const rat = d.rationale ? ` — _${d.rationale}_` : '';
        lines.push(`- \`${d.file}\` — ${d.ruleId}${issue}${rat}`);
      }
      lines.push('');
    }
  }
  fs.writeFileSync(outputPath, lines.join('\n'));
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/node/utils/releaseReview/summary.ts src/tests/backend/specs/releaseReview-utils.ts
git commit -m "feat(reviews): add session summary writer"
```

---

## Task 9: CLI entry point

A single `cli.ts` that dispatches to all helper modules. Invoked from the slash command via `pnpm --filter ep_etherpad-lite exec tsx src/node/utils/releaseReview/cli.ts <command> [args...]`. Reads finding JSON files from a run-dir, writes results back to the run-dir.

Commands:
- `next-run-id <baseDir>` → prints next run-id
- `aggregate <runDir> <suppressionPath> <severityFloor>` → reads `*.json` from runDir, writes `merged.json`
- `triage <runDir>` → reads `merged.json`, writes `triage.json`
- `append-suppression <suppressionPath> <jsonEntry>` → appends one entry (entry passed as JSON string)
- `summary <input.json> <output.md>` → reads SummaryInput from input.json, writes markdown

**Files:**
- Create: `src/node/utils/releaseReview/cli.ts`
- Modify: `src/tests/backend/specs/releaseReview-utils.ts` (append CLI integration test)

- [ ] **Step 1: Append failing test**

```typescript
  describe('cli', function () {
    const {execFileSync} = require('child_process');
    const tmpDir = path.join(FIXTURE_DIR, '_tmp-cli');
    const cliPath = path.join(__dirname, '..', '..', '..', 'node', 'utils', 'releaseReview', 'cli.ts');

    beforeEach(function () {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, {recursive: true});
      fs.mkdirSync(tmpDir, {recursive: true});
    });
    after(function () {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, {recursive: true});
    });

    const runCli = (args: string[]): string =>
      execFileSync('node', ['--import', 'tsx', cliPath, ...args], {encoding: 'utf8'});

    it('next-run-id prints expected id for empty base dir', function () {
      const out = runCli(['next-run-id', tmpDir]).trim();
      assert.match(out, /^run-\d{4}-\d{2}-\d{2}-1$/);
    });

    it('aggregate reads runDir JSONs, writes merged.json with severity floor applied', function () {
      const runDir = path.join(tmpDir, 'run-2026-05-09-1');
      fs.mkdirSync(runDir);
      fs.writeFileSync(path.join(runDir, 'tool-findings.json'), JSON.stringify([
        {source: 'semgrep', fingerprint: 'a'.repeat(64), severity: 'high', category: 'cve', file: 'x.ts', line: 1, ruleId: 'r1', message: 'm1'},
        {source: 'semgrep', fingerprint: 'b'.repeat(64), severity: 'low', category: 'lint', file: 'x.ts', line: 2, ruleId: 'r2', message: 'm2'},
      ]));
      const supPath = path.join(tmpDir, 'sup.yml');
      fs.writeFileSync(supPath, 'findings: []\n');
      runCli(['aggregate', runDir, supPath, 'medium']);
      const merged = JSON.parse(fs.readFileSync(path.join(runDir, 'merged.json'), 'utf8'));
      assert.equal(merged.length, 1);
      assert.equal(merged[0].severity, 'high');
    });

    it('aggregate enriches findings without fingerprint by computing from file content', function () {
      const runDir = path.join(tmpDir, 'run-2026-05-09-2');
      fs.mkdirSync(runDir);
      // Use the sample fixture as the "source under review".
      const sampleAbs = path.join(FIXTURE_DIR, 'sample-source.ts');
      fs.writeFileSync(path.join(runDir, 'auth-sessions.json'), JSON.stringify({
        findings: [
          {source: 'auth-sessions', severity: 'high', category: 'bug', file: sampleAbs, line: 6, ruleId: 'auth-sessions.token-equality', message: 'token == null'},
        ],
      }));
      const supPath = path.join(tmpDir, 'sup-empty.yml');
      fs.writeFileSync(supPath, 'findings: []\n');
      runCli(['aggregate', runDir, supPath, 'medium']);
      const merged = JSON.parse(fs.readFileSync(path.join(runDir, 'merged.json'), 'utf8'));
      assert.equal(merged.length, 1);
      assert.match(merged[0].fingerprint, /^[0-9a-f]{64}$/);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: FAIL — `cli.ts` does not exist.

- [ ] **Step 3: Implement cli.ts**

Write `src/node/utils/releaseReview/cli.ts`:

```typescript
'use strict';

import * as fs from 'fs';
import * as path from 'path';
import {nextRunId, todayIso} from './runDir';
import {loadSuppression, appendSuppression} from './suppression';
import {aggregate} from './aggregate';
import {classify} from './triage';
import {writeSummary} from './summary';
import {computeFingerprint} from './fingerprint';
import {Finding, Severity, SuppressionEntry} from './types';

const die = (msg: string): never => {
  process.stderr.write(`release-review-cli: ${msg}\n`);
  process.exit(2);
  throw new Error('unreachable');
};

const readJson = <T>(p: string): T => {
  if (!fs.existsSync(p)) die(`file not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};

const cmds: Record<string, (args: string[]) => void> = {
  'next-run-id': (args) => {
    const [baseDir, dateMaybe] = args;
    if (!baseDir) die('usage: next-run-id <baseDir> [date]');
    process.stdout.write(nextRunId(baseDir, dateMaybe || todayIso()) + '\n');
  },

  aggregate: (args) => {
    const [runDir, supPath, floor] = args;
    if (!runDir || !supPath || !floor) die('usage: aggregate <runDir> <suppressionPath> <severityFloor>');
    const fileLineCache = new Map<string, string[]>();
    const readLines = (file: string): string[] => {
      if (!fileLineCache.has(file)) {
        fileLineCache.set(
          file,
          fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [],
        );
      }
      return fileLineCache.get(file)!;
    };
    const enrich = (raw: any): Finding => {
      // Subagent JSON may be top-level array OR {findings: [...]}.
      if (raw.fingerprint) return raw;
      const lines = readLines(raw.file);
      const fp = computeFingerprint(raw.ruleId, raw.file, raw.line, lines);
      return {...raw, fingerprint: fp};
    };
    const findingsArrays: Finding[][] = [];
    for (const name of fs.readdirSync(runDir)) {
      if (!name.endsWith('.json') || name === 'merged.json' || name === 'triage.json') continue;
      const parsed = readJson<any>(path.join(runDir, name));
      const arr: any[] = Array.isArray(parsed) ? parsed : (parsed.findings ?? []);
      findingsArrays.push(arr.map(enrich));
    }
    const sup = loadSuppression(supPath);
    const merged = aggregate(findingsArrays, sup, floor as Severity);
    fs.writeFileSync(path.join(runDir, 'merged.json'), JSON.stringify(merged, null, 2));
    process.stdout.write(`wrote ${merged.length} findings to merged.json\n`);
  },

  triage: (args) => {
    const [runDir] = args;
    if (!runDir) die('usage: triage <runDir>');
    const merged = readJson<Finding[]>(path.join(runDir, 'merged.json'));
    const buckets = classify(merged);
    fs.writeFileSync(path.join(runDir, 'triage.json'), JSON.stringify(buckets, null, 2));
    process.stdout.write(`fixNow=${buckets.fixNow.length} issue=${buckets.issue.length} suppress=${buckets.suppress.length}\n`);
  },

  'append-suppression': (args) => {
    const [supPath, jsonEntry] = args;
    if (!supPath || !jsonEntry) die('usage: append-suppression <path> <jsonEntry>');
    const entry: SuppressionEntry = JSON.parse(jsonEntry);
    appendSuppression(supPath, entry);
    process.stdout.write('ok\n');
  },

  summary: (args) => {
    const [inputPath, outputPath] = args;
    if (!inputPath || !outputPath) die('usage: summary <inputJson> <outputMd>');
    writeSummary(readJson(inputPath), outputPath);
    process.stdout.write(`wrote ${outputPath}\n`);
  },
};

const main = (): void => {
  const [, , cmd, ...rest] = process.argv;
  const fn = cmd ? cmds[cmd] : undefined;
  if (!fn) die(`unknown command: ${cmd ?? '(none)'} (try: ${Object.keys(cmds).join(', ')})`);
  fn(rest);
};

main();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: PASS — CLI tests green.

- [ ] **Step 5: Commit**

```bash
git add src/node/utils/releaseReview/cli.ts src/tests/backend/specs/releaseReview-utils.ts
git commit -m "feat(reviews): add CLI entry point for /release-review helpers"
```

---

## Task 10: Phase 1 prompt — `tools.md`

The prompt for the Phase 1 subagent. This subagent runs deterministic tools and emits a normalized JSON file. Prompt is a markdown file with `{{run_id}}` and `{{repo_root}}` placeholders that the slash command substitutes before dispatching.

**Files:**
- Create: `docs/reviews/prompts/tools.md`

- [ ] **Step 1: Write the prompt**

Write `docs/reviews/prompts/tools.md`:

````markdown
# Phase 1 — Tools subagent prompt

You are the deterministic tool sweep stage of a periodic Etherpad code review. You will run a fixed set of tools, normalize their output, and write a single JSON findings file.

**This is a research task with file-write side effects. Do not edit project source. Only write to `/tmp/release-review/{{run_id}}/tool-findings.json`.**

## Mission

Run each of the tools in the table below from `{{repo_root}}`. For every issue each tool reports, emit a `Finding` object (schema below). If a tool isn't installed or fails, record it in `tool_errors` instead of crashing.

## Tools

Run all of these. Capture their JSON/structured output.

| Tool | Command (run from `{{repo_root}}`) | Notes |
|---|---|---|
| pnpm-audit | `pnpm audit --prod --json` | May exit non-zero when vulnerabilities exist; that's expected. Parse stdout. |
| osv-scanner | `osv-scanner --lockfile=pnpm-lock.yaml --format=json` | If not installed, add to tool_errors. |
| semgrep | `semgrep --config=p/javascript --config=p/nodejs --config=p/owasp-top-ten --json --error src/` | Skip `node_modules`, `src/static/js/vendors`, `bin/doc`. |
| eslint | `pnpm --filter ep_etherpad-lite exec eslint --max-warnings=0 --format=json src/` | Only surface findings not already in known-findings (suppression applied later, not by you). |
| madge | `pnpm dlx madge --circular --json src/` | Each cycle is one finding (category=bug). |
| depcheck | `pnpm dlx depcheck --json` | Unused/missing deps → category=supply-chain. |

## Output schema

Write to `/tmp/release-review/{{run_id}}/tool-findings.json`. Top-level shape:

```json
{
  "findings": [<Finding>, ...],
  "tool_errors": [{"tool": "osv-scanner", "error": "command not found"}]
}
```

Each `Finding` is (no fingerprint — added by aggregate stage):

```json
{
  "source": "<tool name from table>",
  "severity": "high|medium|low|info",
  "category": "cve|bug|perf|lint|supply-chain",
  "file": "<repo-relative path>",
  "line": <1-indexed integer>,
  "ruleId": "<tool's rule id, e.g. semgrep.javascript.audit.detect-insecure-randomness>",
  "message": "<one-line description>",
  "remediationHint": "<short hint, omit if none>"
}
```

## Fingerprints

**Do not compute fingerprints yourself.** Emit findings WITHOUT a `fingerprint` field. The aggregate stage (`cli.ts aggregate`) will compute them deterministically from `(ruleId, file, line)` and the file's current content. This guarantees consistency across all sources.

## Severity mapping (tool → finding)

- pnpm-audit / osv-scanner: `high|critical` → high; `moderate` → medium; `low` → low.
- semgrep: rule severity ERROR → high; WARNING → medium; INFO → low.
- eslint: severity 2 → medium; severity 1 → low.
- madge cycles: medium.
- depcheck unused/missing: low.

## Category mapping

- pnpm-audit / osv-scanner: `cve`
- semgrep: `bug` (or `cve` if ruleset hints at security)
- eslint: `lint`
- madge: `bug`
- depcheck: `supply-chain`

## Constraints

- Do NOT read or modify project source beyond what tools require.
- Do NOT respond to me in chat; only emit the JSON file.
- If a tool times out or fails, record it in `tool_errors`. Continue with the others.
- When done, output a single line to stdout: `tool-findings.json: N findings, M tool errors`. Then exit.
````

- [ ] **Step 2: Verify the file is well-formed markdown**

Run: `head -10 docs/reviews/prompts/tools.md` — eyeball that the title and frontmatter look correct.

- [ ] **Step 3: Commit**

```bash
git add docs/reviews/prompts/tools.md
git commit -m "feat(reviews): add Phase 1 tools subagent prompt"
```

---

## Task 11: Phase 2 prompt — `auth-sessions.md`

Prompt for the auth-sessions subagent. Scoped to auth/session/security files.

**Files:**
- Create: `docs/reviews/prompts/auth-sessions.md`

- [ ] **Step 1: Write the prompt**

Write `docs/reviews/prompts/auth-sessions.md`:

````markdown
# Phase 2 — auth-sessions subagent

You are auditing Etherpad's authentication and session-management subsystem for Medium+ severity bugs and security issues. You will read a fixed set of files, identify problems, and emit a single JSON findings file. **Do not edit source.**

## Mission

Find Medium+ severity bugs, CVE-relevant patterns, and security hardening gaps in the assigned subsystem. **Do not report style, lint, or informational findings.** Those are handled by Phase 1.

## Scope (read only these globs, all relative to `{{repo_root}}`)

- `src/node/db/Session*.ts`
- `src/node/db/AuthorManager.ts`
- `src/node/db/SecurityManager.ts`
- `src/node/handler/PadAuth*.ts`
- `src/node/handler/ExpressAuth*.ts`
- `src/node/hooks/express/*auth*`
- `src/node/security/**`
- `src/node/utils/{authorTokenCookie,ensureAuthorTokenCookie,SecretRotator,crypto}.ts`

If a path doesn't match any files, skip silently.

## What to look for

Prioritize:

1. **Token leakage**: tokens or secrets logged, returned to clients, or stored in URLs / headers that get cached.
2. **Session fixation / hijacking**: session id reuse on privilege change, missing rotation on login.
3. **Missing CSRF protection**: state-changing endpoints without same-origin or token check.
4. **Timing-attack-prone comparisons**: `==` / `===` on secrets/tokens instead of `crypto.timingSafeEqual`.
5. **Auth bypass via plugin hooks**: hook contracts that allow plugins to short-circuit auth checks; missing return-value validation.
6. **OIDC / SSO claim handling**: trusting claims without verifying issuer/audience/expiry; treating missing fields as defaults.
7. **Cookie misconfig**: missing `HttpOnly`, `Secure`, `SameSite` on auth-bearing cookies.
8. **Logic bugs in author-erasure / GDPR endpoints**: data leaks across authors, missing tenant boundaries.

## Severity rubric (apply consistently)

- **High** — exploitable now (auth bypass, token leakage to wrong user, RCE shaped finding). CVE-equivalent.
- **Medium** — bug under realistic conditions (race exposes session, timing attack practical with realistic latency, hardening gap that compounds).
- **Low / info** — DO NOT REPORT.

## Output

Write to `/tmp/release-review/{{run_id}}/auth-sessions.json`:

```json
{
  "findings": [<Finding>, ...],
  "scope_summary": "<one-line: how many files scanned, lines reviewed>"
}
```

Each `Finding` (no fingerprint — added by aggregate stage):

```json
{
  "source": "auth-sessions",
  "severity": "high|medium",
  "category": "cve|bug",
  "file": "<repo-relative path>",
  "line": <1-indexed integer>,
  "ruleId": "auth-sessions.<short-slug>",
  "message": "<one-line description>",
  "remediationHint": "<short hint if you have one, otherwise omit>"
}
```

## Worked example

A finding might look like:

```json
{
  "source": "auth-sessions",
  "severity": "medium",
  "category": "bug",
  "file": "src/node/db/SecurityManager.ts",
  "line": 142,
  "ruleId": "auth-sessions.token-equality-non-constant-time",
  "message": "Author token compared with === instead of crypto.timingSafeEqual; allows timing oracle on shared infrastructure.",
  "remediationHint": "Use crypto.timingSafeEqual on Buffer.from(a) and Buffer.from(b) of equal length; reject early on length mismatch."
}
```

## Constraints

- Do NOT respond in chat; emit only the JSON file.
- Cap output at 30 findings. If you find more, prioritize highest-severity / most-confident.
- Be conservative: if you're not sure something is exploitable or wrong, leave it out. False positives waste reviewer time.
- When done, output a single line to stdout: `auth-sessions.json: N findings`.
````

- [ ] **Step 2: Commit**

```bash
git add docs/reviews/prompts/auth-sessions.md
git commit -m "feat(reviews): add Phase 2 auth-sessions subagent prompt"
```

---

## Task 12: Phase 2 prompt — `realtime-api.md`

Same shape as Task 11, scoped to socket.io / API endpoints.

**Files:**
- Create: `docs/reviews/prompts/realtime-api.md`

- [ ] **Step 1: Write the prompt**

Write `docs/reviews/prompts/realtime-api.md`:

````markdown
# Phase 2 — realtime-api subagent

You are auditing Etherpad's realtime (socket.io) and HTTP API surface for Medium+ severity bugs. **Do not edit source.**

## Mission

Find Medium+ severity bugs, CVE-relevant patterns, race conditions, rate-limit gaps, and resource exhaustion issues in the assigned subsystem. **No style or lint findings.**

## Scope

- `src/node/handler/PadMessageHandler.ts`
- `src/node/handler/SocketIO*.ts`
- `src/node/handler/APIHandler.ts`
- `src/node/db/API.ts`
- `src/node/hooks/express/apicalls.ts`
- `src/node/hooks/express/admin*.ts`
- `src/node/handler/admin/**`
- `src/node/utils/Settings.ts` (rate-limit config block only)

## What to look for

1. **Message validation gaps**: client-supplied fields trusted without bounds-check (string length, array length, numeric range).
2. **Race conditions on concurrent ops**: state read / mutate without lock; check-then-act on shared state.
3. **Rate-limit gaps**: endpoints that accept anonymous traffic with no per-IP / per-author cap; cap with bypass via header forwarding.
4. **IDOR on API**: endpoints that look up resources by id without checking caller's authority over that resource.
5. **Broadcast leaks**: messages broadcast to a pad that include data only some viewers should see.
6. **Unbounded growth / DoS**: hot loops, unbounded message queues, regex-on-untrusted-input that can ReDoS, recursion depth.
7. **Admin surface**: admin endpoints reachable without auth, or with auth bypass via plugin hook.
8. **OpenAPI / spec drift**: routes that exist in code but not the spec, or vice versa, when it has security implications.

## Severity rubric

- **High** — exploitable now (auth bypass, RCE, full DoS, IDOR with sensitive data). CVE-equivalent.
- **Medium** — bug under realistic conditions (race exposes data under concurrent edits, ReDoS slows server measurably, missing rate limit allows trivial DoS).
- **Low / info** — DO NOT REPORT.

## Output

Write to `/tmp/release-review/{{run_id}}/realtime-api.json`. Top-level shape: `{"findings": [...], "scope_summary": "..."}`. Each `Finding` (no fingerprint — added by aggregate stage):

```json
{
  "source": "realtime-api",
  "severity": "high|medium",
  "category": "cve|bug",
  "file": "<repo-relative path>",
  "line": <1-indexed integer>,
  "ruleId": "realtime-api.<short-slug>",
  "message": "<one-line description>",
  "remediationHint": "<short hint if you have one, otherwise omit>"
}
```

## Worked example

```json
{
  "source": "realtime-api",
  "severity": "high",
  "category": "bug",
  "file": "src/node/handler/PadMessageHandler.ts",
  "line": 421,
  "ruleId": "realtime-api.unbounded-changeset-broadcast",
  "message": "Server broadcasts the full changeset payload to all pad clients without size cap; a single oversized op can OOM other sessions.",
  "remediationHint": "Reject changesets above MAX_OP_BYTES (e.g. 1MB) before broadcast; emit error back to sender."
}
```

## Constraints

- Do NOT respond in chat; emit only the JSON file.
- Cap output at 30 findings. If you find more, prioritize highest-severity / most-confident.
- Be conservative: if you're not sure something is exploitable or wrong, leave it out.
- When done, output a single line to stdout: `realtime-api.json: N findings`.
````

- [ ] **Step 2: Commit**

```bash
git add docs/reviews/prompts/realtime-api.md
git commit -m "feat(reviews): add Phase 2 realtime-api subagent prompt"
```

---

## Task 13: Phase 2 prompt — `pad-changeset.md`

**Files:**
- Create: `docs/reviews/prompts/pad-changeset.md`

- [ ] **Step 1: Write the prompt**

Write `docs/reviews/prompts/pad-changeset.md`:

````markdown
# Phase 2 — pad-changeset subagent

You are auditing Etherpad's core editing engine — changesets, attribute pool, and pad/revision storage. **Do not edit source.**

## Mission

Find Medium+ severity bugs, CVE-relevant patterns, and operational-correctness issues in the editing engine. **No style or lint.**

## Scope

- `src/static/js/Changeset.ts`
- `src/static/js/AttributePool.ts`
- `src/node/db/Pad.ts`
- `src/node/db/PadManager.ts`
- `src/node/utils/Changeset*.ts`
- `src/node/utils/LineAttribute*.ts`
- `src/static/js/AttributeMap.ts` (if present)
- `src/static/js/changesetutils.ts` (if present)

## What to look for

1. **Changeset validation flaws**: malformed changesets accepted (op type, character bank length, attribute refs out of pool range).
2. **Attribute pool exhaustion**: unbounded growth of pool size from attacker-controlled input; missing dedup.
3. **Revision integrity**: revisions applied out of order or with missing predecessor; head pointer races.
4. **Unbounded growth**: pad growing without limit, history retention not capped where it should be.
5. **OT correctness footguns**: compose/follow that produces invalid output for adversarial input; identity-op handling.
6. **Concurrency**: in-memory caches mutated without serialization; lost-update races on write.
7. **Storage key safety**: pad ids reaching DB key paths without sanitization (only matters for some DB drivers, but worth flagging).

## Severity rubric

- **High** — corrupts pad data, allows another author's content to be erased/mutated, or enables RCE via deserialization.
- **Medium** — pad becomes unrecoverable under realistic edge case, attribute pool grows unbounded under attacker input, race causes data loss in 1-of-N edits.
- **Low / info** — DO NOT REPORT.

## Output

Write to `/tmp/release-review/{{run_id}}/pad-changeset.json`. Top-level shape: `{"findings": [...], "scope_summary": "..."}`. Each `Finding` (no fingerprint — added by aggregate stage):

```json
{
  "source": "pad-changeset",
  "severity": "high|medium",
  "category": "cve|bug",
  "file": "<repo-relative path>",
  "line": <1-indexed integer>,
  "ruleId": "pad-changeset.<short-slug>",
  "message": "<one-line description>",
  "remediationHint": "<short hint if you have one, otherwise omit>"
}
```

## Worked example

```json
{
  "source": "pad-changeset",
  "severity": "medium",
  "category": "bug",
  "file": "src/static/js/AttributePool.ts",
  "line": 88,
  "ruleId": "pad-changeset.unbounded-pool-on-malformed-cset",
  "message": "putAttrib() never checks pool size; an adversarial client can push thousands of unique attributes per minute, growing the pool indefinitely.",
  "remediationHint": "Cap pool growth per pad (e.g. 50k entries); reject changesets that would breach the cap with a clear error."
}
```

## Constraints

- Do NOT respond in chat; emit only the JSON file.
- Cap output at 30 findings. If you find more, prioritize highest-severity / most-confident.
- Be conservative: if you're not sure something is exploitable or wrong, leave it out.
- When done, output a single line to stdout: `pad-changeset.json: N findings`.
````

- [ ] **Step 2: Commit**

```bash
git add docs/reviews/prompts/pad-changeset.md
git commit -m "feat(reviews): add Phase 2 pad-changeset subagent prompt"
```

---

## Task 14: Phase 2 prompt — `db-supply.md`

**Files:**
- Create: `docs/reviews/prompts/db-supply.md`

- [ ] **Step 1: Write the prompt**

Write `docs/reviews/prompts/db-supply.md`:

````markdown
# Phase 2 — db-supply subagent

You are auditing Etherpad's DB layer and supply-chain surface (CI, Docker, packaging). **Do not edit source.**

## Mission

Find Medium+ severity bugs, CVE-relevant patterns, and supply-chain hygiene issues. **No style or lint.**

## Scope

- `src/node/db/DB.ts`
- `src/node/db/SessionStore.ts`
- `src/node/db/*Manager.ts` (the storage-layer ones, e.g. PadManager, GroupManager — when they touch DB keys)
- `Dockerfile*`
- `.github/workflows/**`
- `bin/**`
- `package.json`, `pnpm-lock.yaml`
- `snap/**`, `deb/**`

## What to look for

1. **Injection through DB keys / values**: untrusted strings reaching ueberDB key paths without sanitization (driver-dependent, but check).
2. **Key collision risks**: pad-id namespaces vs author-id vs session-id not clearly separated.
3. **Untrusted plugin install paths**: any code path that executes plugin code from a name that came from user input.
4. **GitHub Actions injection**:
   - `pull_request_target` workflows that check out the PR branch and execute its code.
   - Action steps that interpolate `${{ github.event.* }}` directly into shell.
   - Unpinned third-party actions (no SHA pin).
5. **Dockerfile hygiene**:
   - Running as root unnecessarily.
   - `curl | sh` patterns or unverified downloads.
   - `npm ci` / `pnpm install` after `COPY` of src (cache invalidation issue, not security but report as perf).
6. **Release pipeline**: tags/versions trusted from PR titles or branch names; signing keys committed to repo.
7. **Lockfile drift**: lockfile entries pointing at non-registry sources (git URLs, file paths) for prod deps.

## Severity rubric

- **High** — RCE on CI runner, supply-chain compromise possible (poisoned action / dep, lockfile injection), root in published Docker image when avoidable.
- **Medium** — DB key collision under specific input patterns, unpinned third-party action that could be hijacked, build cache invalidation that's been bothering us.
- **Low / info** — DO NOT REPORT.

## Output

Write to `/tmp/release-review/{{run_id}}/db-supply.json`. Top-level shape: `{"findings": [...], "scope_summary": "..."}`. Each `Finding` (no fingerprint — added by aggregate stage):

```json
{
  "source": "db-supply",
  "severity": "high|medium",
  "category": "cve|bug|supply-chain",
  "file": "<repo-relative path>",
  "line": <1-indexed integer>,
  "ruleId": "db-supply.<short-slug>",
  "message": "<one-line description>",
  "remediationHint": "<short hint if you have one, otherwise omit>"
}
```

## Worked example

```json
{
  "source": "db-supply",
  "severity": "high",
  "category": "supply-chain",
  "file": ".github/workflows/load-test.yml",
  "line": 24,
  "ruleId": "db-supply.gha-pull-request-target-checkout-pr",
  "message": "Workflow uses pull_request_target trigger AND checks out the PR ref, then runs npm scripts. Forked PRs can execute arbitrary code with repo secrets in scope.",
  "remediationHint": "Either drop pull_request_target (use pull_request) OR keep pull_request_target but only run jobs that don't checkout the PR ref / don't execute its code."
}
```

## Constraints

- Do NOT respond in chat; emit only the JSON file.
- Cap output at 30 findings. If you find more, prioritize highest-severity / most-confident.
- Be conservative: if you're not sure something is exploitable or wrong, leave it out.
- When done, output a single line to stdout: `db-supply.json: N findings`.
````

- [ ] **Step 2: Commit**

```bash
git add docs/reviews/prompts/db-supply.md
git commit -m "feat(reviews): add Phase 2 db-supply subagent prompt"
```

---

## Task 15: Slash command

The `.claude/commands/release-review.md` file. Markdown prompt that orchestrates the three phases. The slash command IS the orchestrator — when the user runs `/release-review`, the assistant follows the instructions in this file: dispatches subagents (Agent tool), invokes the CLI helpers via Bash, walks findings interactively in the main context.

**Files:**
- Create: `.claude/commands/release-review.md`

- [ ] **Step 1: Verify .claude/commands directory exists**

Run: `ls .claude/ 2>/dev/null && ls .claude/commands/ 2>/dev/null`

If `.claude/commands/` doesn't exist:
```bash
mkdir -p .claude/commands
```

- [ ] **Step 2: Write the slash command**

Write `.claude/commands/release-review.md`:

````markdown
---
description: Run a full-codebase Medium+ review session for a release.
argument-hint: [--resume <run-id>]
---

# /release-review

Periodic full-codebase review. Three phases: deterministic tools, parallel AI subsystem sweeps, interactive Medium+ walkthrough.

**Spec:** `docs/superpowers/specs/2026-05-09-release-review-design.md`
**Plan:** `docs/superpowers/plans/2026-05-09-release-review.md`

## Argument parsing

If the user passed `--resume <run-id>`, set `RESUME=1` and `RUN_ID=<run-id>`. Skip Phase 1 and Phase 2 if `RESUME=1`. Otherwise allocate a fresh run-id (Phase 0 below).

## Phase 0 — Setup

Run:
```bash
RUN_DIR_BASE=/tmp/release-review
RUN_ID=$(pnpm --filter ep_etherpad-lite exec tsx src/node/utils/releaseReview/cli.ts next-run-id "$RUN_DIR_BASE")
mkdir -p "$RUN_DIR_BASE/$RUN_ID"
echo "$RUN_ID"
```
State the run-id to the user before continuing.

## Phase 1 — Tool sweep (skip if --resume)

Read `docs/reviews/prompts/tools.md`. Substitute `{{run_id}}` and `{{repo_root}}` with the live values. Dispatch a single general-purpose Agent with the substituted prompt.

Block until the subagent completes. Verify `/tmp/release-review/$RUN_ID/tool-findings.json` exists. If it doesn't, surface the failure and ask the user whether to continue with Phase 2 only.

## Phase 2 — AI subsystem sweep (skip if --resume)

Read all four prompt files:
- `docs/reviews/prompts/auth-sessions.md`
- `docs/reviews/prompts/realtime-api.md`
- `docs/reviews/prompts/pad-changeset.md`
- `docs/reviews/prompts/db-supply.md`

Substitute placeholders. Dispatch four general-purpose Agents IN PARALLEL — single message, four Agent tool calls.

Block until all four complete. Verify each output JSON exists. For any that didn't run / failed, record `"missing: <name>"` in the merged report so the user knows coverage was partial.

## Phase 3 — Aggregate, suppress, triage, walk

### 3a. Aggregate

```bash
pnpm --filter ep_etherpad-lite exec tsx src/node/utils/releaseReview/cli.ts \
  aggregate "$RUN_DIR_BASE/$RUN_ID" docs/reviews/known-findings.yml medium
```
Reads all `*.json` from the run-dir except `merged.json` / `triage.json`. Writes `merged.json`.

### 3b. Triage

```bash
pnpm --filter ep_etherpad-lite exec tsx src/node/utils/releaseReview/cli.ts \
  triage "$RUN_DIR_BASE/$RUN_ID"
```
Writes `triage.json` with `{fixNow, issue, suppress}` buckets.

### 3c. First-run check

If `docs/reviews/known-findings.yml` has `findings: []` (empty list) AND `merged.json` has 20+ findings, this is a first run. Tell the user:

> First /release-review with no baseline. Found N Medium+ findings. Mark all as accepted-risk baseline (rationale: "baseline at $RUN_ID; not yet triaged") and only show new findings in future runs? [Y/n]

If Y: bulk-append all `merged.json` fingerprints to known-findings.yml via the `append-suppression` CLI command (one call per entry), exit cleanly.

If N: proceed to walkthrough below.

### 3d. Walkthrough

Read `triage.json`. Print the summary header:
```
Auto-triage of N Medium+ findings:
  Fix now:   X (will show patches)
  Issue:     Y (will draft GH issues)
  Suppress:  Z (will propose suppression entries)

Walking high-severity Fix-now first.
```

Track decisions in an array. For EACH finding, in this order:

1. **fixNow bucket, sorted by severity desc, then category rank**:
   - Print: `[N/total] severity / category / file:line / ruleId / message`
   - Read 5-line excerpt around the finding's line.
   - Generate a patch using your understanding of the issue + remediationHint.
   - Show the patch as a unified diff.
   - Ask: "Apply? [Y/n/edit/skip]"
   - On Y: apply via Edit. Append `{fingerprint, action: 'fix', file, ruleId}` to decisions.
   - On n / skip: append `{fingerprint, action: 'skip', file, ruleId}`.
   - On edit: ask for guidance, regenerate patch, re-prompt.

2. **issue bucket**:
   - Print finding. Draft a GitHub issue body (Title: `<rule>: <one-liner>`. Body: severity, file:line, message, remediation, links).
   - Ask: "Create issue / edit body / skip?"
   - On create: run `gh issue create --title "..." --body-file -` (with confirmation). Capture issue URL. Append `{action: 'issue', issueUrl}`.
   - If `gh` is missing: print the body, append `{action: 'skip', rationale: 'gh not available'}`.

3. **suppress bucket**:
   - Print finding + propose `status: accepted-risk` (default) and a one-line rationale based on the message.
   - Ask: "Accept / edit rationale / fix-instead / skip?"
   - On accept: invoke `cli.ts append-suppression` with the entry. Append `{action: 'accepted-risk', rationale}`.
   - On fix-instead: jump to the fixNow flow for this finding.

### 3e. End-of-session summary

Determine the version: read `package.json`'s `version` field; if it ends in a release-track suffix, use as-is. Otherwise ask the user for the upcoming version (e.g. "2.8.0").

Write a `SummaryInput` JSON to `$RUN_DIR_BASE/$RUN_ID/summary-input.json`:
```json
{
  "runId": "$RUN_ID",
  "version": "<resolved>",
  "counts": { "high": <count>, "medium": <count> },
  "decisions": [ ...recorded above... ]
}
```

Then run:
```bash
pnpm --filter ep_etherpad-lite exec tsx src/node/utils/releaseReview/cli.ts \
  summary "$RUN_DIR_BASE/$RUN_ID/summary-input.json" \
  "docs/reviews/<version>-summary.md"
```

Print final instructions:
> Session complete. Suggested next step:
>   git add docs/reviews/known-findings.yml docs/reviews/<version>-summary.md
>   git commit -m "chore(reviews): triage <version> findings"
> Source edits applied during the session are unstaged; review with `git diff` and commit separately.

## Resume mode

When `--resume <run-id>` is passed:
- Skip Phase 1 + Phase 2.
- Verify `$RUN_DIR_BASE/$RUN_ID/` exists; if not, fail with a clear message.
- Skip 3a/3b if `merged.json` and `triage.json` already exist; otherwise re-run them.
- Walk from where the user left off. (For now: walkthrough always restarts from the top of the buckets. The user should track in their head which they've handled, OR `git diff` will show which already have applied fixes — the second run will see those fixes as new code, breaking the fingerprint and dropping them naturally on re-aggregate.)

## Failure handling

- Phase 1 missing: warn, continue with Phase 2 only.
- Phase 2 subagent missing: warn (`"missing: <name>"`), continue.
- Malformed `known-findings.yml`: abort the session with the parser's error message and instructions to fix manually.
- Disk write fails to `/tmp/release-review/...`: surface the error and exit; the user's environment likely has /tmp constraints.
````

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/release-review.md
git commit -m "feat(reviews): add /release-review slash command orchestrator"
```

---

## Task 16: README + smoke test docs

Flesh out `docs/reviews/README.md` with operator docs: when to run, the schema, the smoke test procedure.

**Files:**
- Modify: `docs/reviews/README.md`

- [ ] **Step 1: Replace the README skeleton**

Write `docs/reviews/README.md`:

````markdown
# /release-review — operator guide

Periodic full-codebase Medium+ review for Etherpad releases.

- **Design**: `docs/superpowers/specs/2026-05-09-release-review-design.md`
- **Implementation plan**: `docs/superpowers/plans/2026-05-09-release-review.md`
- **Slash command**: `.claude/commands/release-review.md`
- **Helper modules**: `src/node/utils/releaseReview/`
- **Tests**: `src/tests/backend/specs/releaseReview-utils.ts`

## When to run

Once per major release version, e.g. before cutting `v2.8.0`. The intent is **periodic** rather than per-PR; CodeQL + dependency-review handle PR-time security signal.

## How to run

In Claude Code, on the `develop` branch:

```
/release-review
```

This runs the full three-phase review: tools → 4 parallel AI subsystem sweeps → live Medium+ walkthrough.

To resume a partially-completed session:

```
/release-review --resume run-2026-05-09-1
```

The run-id is printed at the start of every session.

## What it produces

- **In-session**: live walkthrough where you triage each Medium+ finding (fix / file issue / suppress).
- **Committed at end**:
  - `docs/reviews/known-findings.yml` — appended with new suppression entries
  - `docs/reviews/<version>-summary.md` — session summary
- **Source edits**: applied during Fix-now batch; review with `git diff` and commit separately.

## Suppression file — `docs/reviews/known-findings.yml`

Tracks findings already triaged. New entries are added by `/release-review` automatically. Re-triage by hand-editing:

- **Remove an entry** to make the finding resurface in the next run.
- **Change `status`** to reclassify.
- **Never hand-edit `fingerprint`** — it must come from a real run.

Schema:

```yaml
findings:
  - fingerprint: <sha256>
    status: wontfix | accepted-risk | deferred
    ruleId: <tool or AI rule id>          # optional
    file: <repo-relative path>            # optional
    line: <int>                           # optional
    decidedAt: <YYYY-MM-DD>
    decidedInRun: <run-id>
    rationale: <free text>
    targetRelease: <version>              # required iff status == deferred
```

## First run

Your first `/release-review` will surface every accumulated issue at once — likely 30–50 Medium+ findings. The session offers baseline-acceptance: bulk-mark everything as `accepted-risk` and only show new findings going forward. Re-triage at your leisure by editing the suppression file.

## Smoke test

Before each release, after the smoke check that follows the slash command, verify:

1. The run-dir exists: `ls /tmp/release-review/$RUN_ID/`
2. `merged.json` is present and valid JSON.
3. `triage.json` is present.
4. The summary file is written: `cat docs/reviews/<version>-summary.md`

If anything looks off, re-run with `--resume $RUN_ID` and inspect `merged.json` directly.

## Updating the prompts

Each Phase 2 prompt (`docs/reviews/prompts/*.md`) is intentionally a separate, diffable file. When a release surfaces a class of finding the prompts missed, edit the relevant prompt and commit alongside the new fix. Prompts are expected to evolve.

## Adding a new subsystem

To add a fifth subsystem subagent:

1. Add a prompt file at `docs/reviews/prompts/<name>.md` following the same structure.
2. Add it to the parallel-dispatch list in `.claude/commands/release-review.md`.
3. Update `bin/release-review` smoke tests if you cover the new subsystem there.
````

- [ ] **Step 2: Run a final type-check across the new module**

Run: `pnpm run ts-check`
Expected: PASS — no type errors anywhere in `src/`.

- [ ] **Step 3: Run the full unit test suite for the helpers**

Run: `pnpm --filter ep_etherpad-lite run test-utils`
Expected: PASS — all releaseReview tests green.

- [ ] **Step 4: Commit**

```bash
git add docs/reviews/README.md
git commit -m "docs(reviews): operator guide for /release-review"
```

---

## Task 17: End-to-end manual smoke test

This task is not a code change — it's a manual verification of the assembled system. It exists to catch integration issues that unit tests miss.

- [ ] **Step 1: Verify all helper modules type-check together**

Run: `pnpm run ts-check`
Expected: PASS.

- [ ] **Step 2: Verify the CLI is invokable end-to-end**

```bash
mkdir -p /tmp/release-review-smoke/run-2026-05-09-1
cat > /tmp/release-review-smoke/run-2026-05-09-1/seed.json <<'EOF'
[
  {"source":"semgrep","fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","severity":"high","category":"cve","file":"x.ts","line":1,"ruleId":"r1","message":"m1"},
  {"source":"semgrep","fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","severity":"low","category":"lint","file":"x.ts","line":2,"ruleId":"r2","message":"m2"}
]
EOF
echo 'findings: []' > /tmp/release-review-smoke/sup.yml

pnpm --filter ep_etherpad-lite exec tsx src/node/utils/releaseReview/cli.ts \
  aggregate /tmp/release-review-smoke/run-2026-05-09-1 /tmp/release-review-smoke/sup.yml medium

cat /tmp/release-review-smoke/run-2026-05-09-1/merged.json
```

Expected: `merged.json` contains exactly one entry (the `high` finding); the `low` finding was filtered.

- [ ] **Step 3: Verify triage writes buckets**

```bash
pnpm --filter ep_etherpad-lite exec tsx src/node/utils/releaseReview/cli.ts \
  triage /tmp/release-review-smoke/run-2026-05-09-1
cat /tmp/release-review-smoke/run-2026-05-09-1/triage.json
```

Expected: JSON with `fixNow`, `issue`, `suppress` keys; the high finding (no remediationHint) should be in `issue`.

- [ ] **Step 4: Verify suppression append is idempotent on file shape**

```bash
pnpm --filter ep_etherpad-lite exec tsx src/node/utils/releaseReview/cli.ts \
  append-suppression docs/reviews/known-findings.yml \
  '{"fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","status":"wontfix","decidedAt":"2026-05-09","decidedInRun":"smoke","rationale":"smoke test"}'

cat docs/reviews/known-findings.yml
```

Expected: header comment preserved; one new entry appended.

Then revert that change so the file ships empty:

```bash
git checkout -- docs/reviews/known-findings.yml
```

- [ ] **Step 5: Cleanup smoke artifacts**

```bash
rm -rf /tmp/release-review-smoke
```

- [ ] **Step 6: Final verification**

Run: `pnpm run ts-check && pnpm --filter ep_etherpad-lite run test-utils`
Expected: PASS for both. No new lint errors introduced.

No commit for this task — verification only. If anything failed, file it as a follow-up bug rather than mutating the plan.

---

## Out of scope (explicit)

The following are NOT in this plan and should not be added during implementation:

- Replacing CodeQL, dependabot, or dependency-review.
- Reporting low/info findings to the user (filtered out by design).
- Cross-release trend analysis (counts of new findings per release, time-to-fix). Possible follow-up.
- Plugin ecosystem review beyond core (`src/plugin_packages/`).
- Browser-extension or mobile surface (no such surface exists).
