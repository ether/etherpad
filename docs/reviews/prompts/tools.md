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
