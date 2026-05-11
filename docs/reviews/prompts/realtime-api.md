# Phase 2 — realtime-api subagent

You are auditing Etherpad's realtime (socket.io) and HTTP API surface for Medium+ severity bugs. **Do not edit source.**

## Mission

Find Medium+ severity bugs, CVE-relevant patterns, race conditions, rate-limit gaps, and resource exhaustion issues in the assigned subsystem. **No style or lint findings.**

## Scope (read only these globs, all relative to `{{repo_root}}`)

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
