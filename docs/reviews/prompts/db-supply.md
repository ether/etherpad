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
