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

1. The run-dir exists: `ls /tmp/release-review/<run-id>/`
2. `merged.json` is present and valid JSON.
3. `triage.json` is present.
4. The summary file is written: `cat docs/reviews/<version>-summary.md`

If anything looks off, re-run with `--resume <run-id>` and inspect `merged.json` directly.

## Updating the prompts

Each Phase 2 prompt (`docs/reviews/prompts/*.md`) is intentionally a separate, diffable file. When a release surfaces a class of finding the prompts missed, edit the relevant prompt and commit alongside the new fix. Prompts are expected to evolve.

## Adding a new subsystem

To add a fifth subsystem subagent:

1. Add a prompt file at `docs/reviews/prompts/<name>.md` following the same structure.
2. Add it to the parallel-dispatch list in `.claude/commands/release-review.md`.
3. Update `bin/release-review` smoke tests if you cover the new subsystem there.
