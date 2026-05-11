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
