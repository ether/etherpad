# /release-review — Periodic full-codebase review session

**Status:** Design approved 2026-05-09
**Owner:** John McLear
**Target use:** Run once per release version (e.g. before cutting v2.8.0) to find CVEs, real bugs, and meaningful perf issues.

## Problem

Etherpad already has CodeQL, dependency-review, and dependabot running in CI. Those catch pattern-level and known-CVE issues, but not:

- Logic bugs that need cross-file reasoning
- Race conditions in socket.io / message handling
- Auth-bypass shapes that span hooks and plugin entry points
- Performance footguns (unbounded growth, hot loops, redundant DB calls)
- Supply-chain hygiene that goes beyond direct deps (CI injection patterns, unpinned actions, Docker surface)

The previous attempt at `/ultrareview` timed out at 30 minutes without producing usable output. The user wants an interactive walkthrough where I surface ranked findings, not a fire-and-forget cloud job.

## Goals

- **Periodic & on-demand**: Run via `/release-review` slash command before each release.
- **Full codebase**: All four core subsystems get a deep AI sweep every session, plus deterministic tool sweep.
- **Live triage**: User decides Fix-now / Issue / Suppress per finding interactively, no offline report.
- **Sustainable**: Suppression file prevents repeat findings from dominating each release.
- **Reliable**: Subagents protect main context so full-codebase scans don't trigger compaction mid-session.

## Non-goals

- Replacing CodeQL or dependabot (this complements them).
- Catching style / lint / informational findings — those stay in CI.
- Automated remediation without human approval.

## Architecture

Three phases, orchestrated by `/release-review`:

```
Phase 1 — Tool sweep (1 subagent)
   → /tmp/release-review/<run-id>/tool-findings.json

Phase 2 — AI sweep (4 subagents in parallel)
   → /tmp/release-review/<run-id>/{auth-sessions,realtime-api,pad-changeset,db-supply}.json

Phase 3 — Aggregate + auto-triage + walkthrough (main context)
   ├─ Merge + dedupe by fingerprint
   ├─ Apply docs/reviews/known-findings.yml
   ├─ Drop severity < Medium
   ├─ Auto-classify into Fix-now / Issue / Suppress buckets
   └─ Walk live; record decisions; write summary
```

**Key principle:** main context is the conductor. It never reads source during a review — all reading happens in subagents. This is what makes full-codebase scans tractable without compaction.

## Phase 1 — Tool sweep

A single subagent (general-purpose) runs all deterministic tools and emits one normalized findings file. Splitting tools across multiple subagents adds coordination cost without benefit — they're cheap and fast.

### Tools

| Tool | What it catches |
|---|---|
| `pnpm audit --prod --json` | Known CVEs in production deps |
| `osv-scanner --lockfile=pnpm-lock.yaml --format=json` | Broader CVE database than npm's |
| `semgrep --config=p/javascript --config=p/nodejs --config=p/owasp-top-ten --json` | Pattern-based bugs/security antipatterns |
| `pnpm --filter ep_etherpad-lite run lint -- --max-warnings=0 --format=json` | Project lint config; only new violations vs main |
| `madge --circular --json src/` | Circular dependencies |
| `depcheck --json` | Unused/missing deps |

**Ignore paths** (passed to semgrep + eslint): `node_modules`, `src/static/js/vendors`, `bin/doc`, generated client output. Vendored code is out of scope; we don't own its issues.

**Optional** (gated behind tool-availability check, not a flag): `retire` for browser-side libs, `license-checker` for license drift. Subagent emits `tool_errors` if any tool isn't installed; walkthrough surfaces missing-tool warnings as info findings.

### Finding schema

```json
{
  "tool": "semgrep",
  "fingerprint": "<sha256 of rule-id + file + normalized-line-context>",
  "severity": "high|medium|low|info",
  "category": "cve|bug|perf|lint|supply-chain",
  "file": "src/node/handler/PadMessageHandler.ts",
  "line": 421,
  "rule_id": "...",
  "message": "...",
  "remediation_hint": "...",
  "first_seen": "<run-id or null if new>"
}
```

### Fingerprint stability

Fingerprints must survive line-shift drift. Compute as:

```
sha256(rule_id || "::" || file_path || "::" || normalized_context)
```

where `normalized_context` is the 5 lines around the finding line, with leading/trailing whitespace stripped per line and identifiers preserved. When code drifts up/down, fingerprint stays stable. When the surrounding logic actually changes, fingerprint breaks and the finding correctly re-surfaces.

## Phase 2 — AI subagent sweep

Four general-purpose subagents run in parallel via a single message with multiple Agent tool uses. Each scoped to specific globs. Each returns the same JSON schema as Phase 1.

### Subagent assignments

| Subagent | File globs | Focus |
|---|---|---|
| **auth-sessions** | `src/node/db/Session*.ts`, `src/node/db/AuthorManager.ts`, `src/node/handler/{Pad,Express}Auth*.ts`, `src/node/hooks/express/*auth*`, `src/node/security/**`, `src/node/db/SecurityManager.ts` | Token leakage, session fixation, missing CSRF, timing-attack-prone comparisons, auth bypass via plugin hooks, OIDC/SSO claim handling |
| **realtime-api** | `src/node/handler/PadMessageHandler.ts`, `src/node/handler/SocketIO*.ts`, `src/node/hooks/express/apicalls.ts`, `src/node/db/API.ts`, `src/node/handler/APIHandler.ts`, admin endpoints | Message validation, rate-limit gaps, race conditions on concurrent ops, broadcast leaks, IDOR on API, unbounded loops/memory growth |
| **pad-changeset** | `src/static/js/Changeset.ts`, `src/static/js/AttributePool.ts`, `src/node/db/Pad.ts`, `src/node/db/PadManager.ts`, `src/node/utils/{Changeset,LineAttribute}*.ts` | Changeset validation flaws, attribute pool exhaustion, revision integrity, unbounded growth, OT correctness footguns |
| **db-supply** | `src/node/db/DB.ts`, `src/node/db/*Manager.ts` (storage), `Dockerfile*`, `.github/workflows/**`, `bin/**`, `package.json`, `pnpm-lock.yaml`, `snap/**`, `deb/**` | Injection through ueberDB key/value handling, key-collision risks, untrusted plugin install paths, GH Actions injection (`pull_request_target`, unpinned actions), Docker image surface |

### Subagent prompt structure

Each prompt has four parts:

1. **Mission** — "Find Medium+ severity bugs / CVE-relevant patterns / perf issues in your assigned subsystem. Do not report style or lint."
2. **Scope** — explicit glob list. Read only these files.
3. **Output contract** — emit JSON to `/tmp/release-review/<run-id>/<name>.json` matching the schema. Nothing else.
4. **Severity rubric** — calibrated definitions (below).

### Severity rubric (shared across all subagents)

- **High** — exploitable now (CVE-equivalent), data loss, auth bypass, RCE.
- **Medium** — bug under realistic conditions, perf cliff under realistic load, hardening gap that compounds with other bugs.
- **Low** — code smell, minor inefficiency, defensive-coding suggestion. *Filtered before walkthrough.*
- **Info** — style, naming, doc gap. *Filtered.*

### Why parallel

The four subsystems share little code. Sequential runs would be 4× slower with no quality gain. The downside — subagents can't share findings — is acceptable because cross-subsystem patterns are rare relative to the speed win.

## Phase 3 — Aggregate, suppress, auto-triage, walk

### Aggregation

```
1. Load /tmp/release-review/<run-id>/*.json → merged list
2. Dedupe by fingerprint → keep highest severity, union sources
3. Load docs/reviews/known-findings.yml
4. Filter: drop fingerprints marked "wontfix" or "accepted-risk"
5. Annotate: fingerprints marked "deferred" stay; show "deferred since <run-id>"
6. Drop severity ∈ {low, info} → /tmp appendix file (openable later)
7. Sort: high first, then medium; within each, by category (cve > bug > perf > supply-chain)
```

### Suppression file — `docs/reviews/known-findings.yml`

```yaml
findings:
  - fingerprint: a3f9c8...
    status: wontfix          # wontfix | accepted-risk | deferred
    rule_id: semgrep.javascript.audit.detect-insecure-randomness
    file: src/node/utils/randomString.ts
    line: 14
    decided_at: 2026-05-09
    decided_in_run: run-2026-05-09-1
    rationale: "Used only for non-security pad IDs; high-entropy not required."
  - fingerprint: b2e1...
    status: deferred
    target_release: 2.9.0
    rationale: "Tracked in #7712; refactor planned next minor."
```

**New entries** are only added through `/release-review` decisions — the slash command writes them with full provenance (run-id, decided_at, rationale). **Existing entries** can be edited by hand to re-triage (change status, remove to resurface) — see "Re-triaging baseline" below. The `fingerprint` field must never be hand-edited.

### Auto-triage

Each remaining Medium+ finding is classified into one of three buckets *before* the user is asked anything:

| Bucket | When | Walkthrough action |
|---|---|---|
| **Fix now** | Single-file, ≲20 LOC change, clear remediation, low blast radius | Generate patch; show diff; user says Y/N/Edit |
| **Issue** | Multi-file, needs design discussion or tradeoff | Draft GH issue body; user says Create/Edit/Skip |
| **Suppress** | Likely false positive, intentional, accepted-risk, out of scope | Propose rationale + status; user says Accept/Edit/Fix-instead/Skip |

**Safety property:** classification never auto-applies anything. Every Fix-now requires explicit Y before `Edit` runs. Every suppression entry waits for keypress before being written.

### Walkthrough flow

```
1. Print triage summary:
     Auto-triage of N Medium+ findings:
       Fix now:   X
       Issue:     Y
       Suppress:  Z

2. Walk Fix-now bucket (high-severity first, then medium):
     For each:
       - Show severity / category / file:line / message / 5-line excerpt
       - Show generated patch
       - [Y]es / [N]o / [E]dit / [S]kip
       - On Y: apply Edit; append to decisions.log
       - On N or S: leave for next session
       - On E: open inline editor for the patch, then Y/N

3. Walk Issue bucket:
     For each:
       - Show finding + drafted issue body
       - [C]reate / [E]dit / [S]kip
       - On C: gh issue create with confirmation; record issue # in decisions.log

4. Walk Suppress bucket:
     For each:
       - Show finding + proposed status (wontfix/accepted-risk/deferred) + proposed rationale
       - [A]ccept / [E]dit / [F]ix-instead / [S]kip
       - On A: append to known-findings.yml
       - On F: jump to Fix-now path for this finding

5. End-of-session:
     - Write docs/reviews/<version>-summary.md (one-line per finding + decisions)
     - Print: "Stage and commit known-findings.yml + summary in a single follow-up commit."
```

### First-run UX

First `/release-review` will surface every accumulated issue at once — likely 30–50 Medium+ findings. To avoid an unworkable session, we offer baseline-acceptance:

```
30 findings detected on first run.
Mark all as baseline-accepted (status: accepted-risk, rationale: "baseline at <run-id>; not yet triaged")
and only show new findings going forward? [Y/n]
```

If Y: bulk-write entries to `known-findings.yml`, exit session. User can then re-triage at their leisure by manually editing the YAML.

If N: walk all 30 normally.

### Re-triaging baseline

Manual editing of `known-findings.yml` is supported for re-triaging. Removing an entry causes the finding to resurface next session. Changing `status` reclassifies. The only restriction: never edit `fingerprint` (it must come from a real run).

## Slash command — `.claude/commands/release-review.md`

```markdown
---
description: Run a full-codebase Medium+ review session for a release
argument-hint: [--resume <run-id>]
---

# /release-review

Steps:
1. Determine run-id: `run-YYYY-MM-DD-N` (N = next available for today)
2. Create `/tmp/release-review/<run-id>/`
3. If --resume <run-id>: skip to step 6 with existing JSON files
4. Phase 1: dispatch tools subagent (general-purpose); block until done
5. Phase 2: dispatch 4 subsystem subagents in parallel (single message, multiple Agent calls)
6. Phase 3: aggregate, suppress, auto-triage, walk
```

### Prompt templates

Stored as files in `docs/reviews/prompts/`:

```
docs/reviews/prompts/
├── tools.md
├── auth-sessions.md
├── realtime-api.md
├── pad-changeset.md
└── db-supply.md
```

Each is ~100+ lines (mission + scope + output contract + severity rubric + worked examples). Storing as files makes them diffable across releases — we will iterate on them.

The slash command reads each prompt, substitutes `{{run_id}}` and `{{repo_root}}`, then dispatches.

### Run directory layout

```
/tmp/release-review/<run-id>/
├── tool-findings.json
├── auth-sessions.json
├── realtime-api.json
├── pad-changeset.json
├── db-supply.json
├── merged.json          # aggregated, post-suppression
├── triage.json          # auto-classified buckets
└── decisions.log        # append-only Y/N/edit responses
```

`/tmp` is acceptable because the run dir is ephemeral working state; the durable artifacts (`known-findings.yml`, `<version>-summary.md`) land in the repo.

### Outputs that land in the repo

- `docs/reviews/known-findings.yml` — updated with new suppressions
- `docs/reviews/<version>-summary.md` — written at session end (run-id, finding counts by severity, decisions taken)
- Source edits applied during Fix-now batch

User commits the suppression-file diff and summary in a single follow-up commit.

## Operational concerns

### Preconditions

- `pnpm`, `osv-scanner`, `semgrep`, `madge`, `depcheck` available on PATH (Phase 1 tools subagent reports any missing as `tool_errors`).
- `gh` CLI authenticated (used by Issue bucket; if missing, Issue bucket falls back to printing the drafted body for manual paste).

### Failure handling

- **Phase 2 subagent crash/timeout**: Main context proceeds with the others' findings. Merged report flags `"missing: <subagent-name> (failed at <time>)"`. User can `--resume <run-id>` to re-run only the failed subsystem (lightweight escape — run-dir already exists).
- **Phase 1 individual tool failure** (e.g., `osv-scanner` not installed): Subagent emits findings from tools that ran, plus `tool_errors` array. Walkthrough surfaces missing-tool warnings as info findings.
- **Missing `known-findings.yml`**: Created empty on first run. No special-casing.
- **Malformed `known-findings.yml`**: Session aborts with a clear error pointing at the bad entry. We do *not* silently skip — a corrupt suppression file is a real problem.

### Validating the system itself

- `src/tests/backend/specs/release-review.spec.ts` covering:
  - Fingerprint stability across whitespace changes
  - Suppression-file parsing (well-formed and malformed YAML)
  - Severity filter
  - Run-dir layout creation
  - Aggregation/dedupe logic with synthetic findings
- A fixture `src/tests/backend/fixtures/release-review/` with a known-bad seed file; dry-run mode confirms `/release-review` flags the seeded issues.
- Manual smoke test documented in `docs/reviews/README.md`: "Before each release, run `/release-review` against `develop`. If findings list looks empty/wrong, re-run with `--resume <run-id>` and inspect `merged.json` directly."

## Files added/modified

| Path | Purpose |
|---|---|
| `.claude/commands/release-review.md` | Slash command |
| `docs/reviews/README.md` | Documentation, smoke test |
| `docs/reviews/known-findings.yml` | Suppression file (starts empty) |
| `docs/reviews/prompts/tools.md` | Phase 1 prompt |
| `docs/reviews/prompts/auth-sessions.md` | Phase 2 prompt |
| `docs/reviews/prompts/realtime-api.md` | Phase 2 prompt |
| `docs/reviews/prompts/pad-changeset.md` | Phase 2 prompt |
| `docs/reviews/prompts/db-supply.md` | Phase 2 prompt |
| `src/tests/backend/specs/release-review.spec.ts` | Tests |
| `src/tests/backend/fixtures/release-review/` | Test fixtures |

## Out of scope (for this design)

- Replacing CodeQL / dependabot.
- Style / lint / info findings (CI handles them).
- Cross-release trend analysis (could be a follow-up: count of new findings per release, time-to-fix).
- Plugin ecosystem review (only `src/plugin_packages/` scoped if added later — current design only covers core).
