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
