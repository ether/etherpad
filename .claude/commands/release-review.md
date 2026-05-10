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
