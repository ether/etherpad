# Etherpad Auto-Update — Design Spec

**Date:** 2026-04-25
**Author:** John McLear (johnmclear)
**Status:** Approved for planning
**Related:** none yet

## Problem

Etherpad has no built-in mechanism to tell an admin a new version exists, no in-product update flow, and no automatic patching. The result: many public Etherpad instances run unpatched versions for months or years, and CVEs land on installs whose admins are not even aware an update shipped.

## Goal

Add a four-tier self-update subsystem to Etherpad core. Each tier is opt-in via a single `updates.tier` setting. Higher tiers subsume lower ones.

| Tier | Setting | Behavior |
|---|---|---|
| 0 | `off` | No version checks, no banner, no badge. |
| 1 | `notify` | Default. Periodic version check, admin banner, severe/vulnerable pad badge. No execution. |
| 2 | `manual` | Tier 1 + admin can click "Apply now" to update from the UI. |
| 3 | `auto` | Tier 2 + new releases are scheduled automatically after a configurable grace window during which the admin can cancel. |
| 4 | `autonomous` | Tier 3 + scheduling is gated to an admin-defined maintenance window. |

Tiers above what the install method allows are silently downgraded with a logged warning. A docker install will refuse to enable tier 2+ even if the admin sets `tier: "autonomous"`.

## Non-goals

- Updating plugins. The admin already has a plugin manager. The design preserves a `target: 'core' | 'plugins'` seam, but plugin updates are out of scope for this spec.
- Updating Etherpad in environments where the filesystem is ephemeral or read-only (Docker, snap, apt/brew). Those installs stay on tier 1.
- Telemetry of any kind. The GitHub poll uses no auth, no instance identifiers, no version reporting upstream.
- DB schema or `settings.json` schema migration logic. Etherpad's existing on-boot migration runs after restart. If a migration fails, the new version fails its post-update health check and we roll back.

## Decisions

These were settled during brainstorming and are load-bearing for the rest of the spec.

- **Update source:** GitHub Releases API (`api.github.com/repos/ether/etherpad/releases/latest`). Configurable via `updates.githubRepo` for forks.
- **Install-method detection:** auto-detect at boot with admin override. Heuristics: `/.dockerenv` → docker; `.git/HEAD` + writable tree → git; writable `node_modules` + lockfile → npm; else `managed`. Override via `updates.installMethod`.
- **Execution model:** in-process. Etherpad spawns the update steps (git fetch, git checkout, pnpm install, build:ui) as child processes, then exits with code `75`. Etherpad must be run under a process supervisor (systemd, pm2, docker restart-policy, etc.) — that is best practice anyway.
- **Tier 4 scope:** all releases (not just security/patch). Restricted only by maintenance window.
- **Rollback:** on every update we snapshot the git SHA and copy `pnpm-lock.yaml` to `var/update-backup/`. After restart, a 60s health-check timer fires; on failure we restore SHA + lockfile, run `pnpm install`, and exit again. A boot-count guard catches crash loops.
- **Active sessions:** 60-second drain. We broadcast a system message at T-60, T-30, T-10 to every connected pad, refuse new connections during the drain, then exit at T=0. Best-effort: we do not wait for client acks past T=0.
- **Pad-user visibility:** pads see nothing about updates by default. A discreet badge appears only when the running version is `severe` (one or more major versions behind) or `vulnerable` (matched by a `vulnerable-below` directive in a recent release manifest). The badge endpoint never returns the running version string.

## Architecture

A new self-update subsystem lives at `src/node/updater/`. Each unit has one purpose, communicates through narrow interfaces, and is independently testable.

### Components

- **`VersionChecker`** — periodic poller. Hits `api.github.com/repos/ether/etherpad/releases/latest` with `If-None-Match` ETag. Default interval 6h. Caches latest release in memory and on disk at `var/update-state.json`. Parses `vulnerable-below <semver>` directives from the bodies of the most recent N releases to build a runtime `KNOWN_VULNERABLE` set. On 403/rate-limit responses, backs off exponentially. Exposes `getUpdateStatus()`.
- **`InstallMethodDetector`** — runs once at boot. Caches result for the process lifetime.
- **`UpdatePolicy`** — pure function over `(installMethod, tier, currentVersion, latestVersion, settings, now)` → `{canNotify, canManual, canAuto, canAutonomous, reason}`. Single source of truth for "what is allowed." No I/O. Easy to unit-test.
- **`UpdateExecutor`** — performs the update for `git` installs. Records pre-state, runs the update steps as child processes, streams to `var/log/update.log`, exits 75. Held by `var/update.lock` (PID-based, stale locks reaped on boot).
- **`RollbackHandler`** — runs on every boot. Reads `var/update-state.json`. If status is `pending-verification`, arms the health-check timer and increments `bootCount`. If `bootCount > 2`, forces rollback (crash-loop guard). On rollback failure, transitions to terminal `rollback-failed` state which disables auto/autonomous until an admin acknowledges.
- **`SessionDrainer`** — coordinates the 60s drain. Hooks `PadMessageHandler` to broadcast at T-60/-30/-10, sets a "no new connections" flag in the express middleware, signals the executor at T=0.
- **`Scheduler`** (PR 3+) — listens to `VersionChecker` events, evaluates `UpdatePolicy.canAuto/canAutonomous`, applies pre-apply grace and (tier 4) maintenance-window checks. Persists pending update info so a restart during the grace window doesn't drop the schedule.
- **`MaintenanceWindow`** (PR 4) — pure function over `(now, window)`. Handles cross-midnight, DST.

### API surface

Three admin endpoints (auth + CSRF identical to existing `/admin/*`):

- `GET /admin/update/status` — current version, latest, policy result, last update result, in-flight state.
- `POST /admin/update/apply` — manual trigger. Refuses if `UpdatePolicy.canManual` is false or if the lock is held. Permitted in `rollback-failed` (an admin clicking "Apply" *is* the intervention that state requires); the call implicitly acknowledges the prior failure.
- `POST /admin/update/cancel` — works any time before `UpdateExecutor` starts the `git checkout`. Once filesystem changes have begun, returns 409 (we either complete or rollback).
- `POST /admin/update/acknowledge` — clears terminal states (`rollback-failed`, `preflight-failed`, etc.) so future attempts are allowed.
- `GET /admin/update/log` — streams the last 200 lines of `var/log/update.log` for the in-progress UI.

One public endpoint:

- `GET /api/version-status` — returns `{outdated: null | "severe" | "vulnerable"}`. No version string. Memory-cached, max one underlying state read per minute. Public so pad clients can fetch without auth.

### Admin UI

- `admin/src/components/UpdateBanner.tsx` — visible on every admin page when an update exists or last update terminated abnormally.
- `admin/src/pages/UpdatePage.tsx` — full status, changelog (rendered from release body), Apply/Cancel/Acknowledge buttons, log stream view, maintenance-window picker (PR 4).
- New i18n keys under `updater.*`.

### Pad UI

- A small footer badge component fetches `/api/version-status` once on pad load. Renders nothing on `null`, a discreet icon on `severe`, a more prominent indicator on `vulnerable`.

## Settings

```jsonc
{
  "updates": {
    "tier": "notify",                  // "off" | "notify" | "manual" | "auto" | "autonomous"
    "source": "github",                // future: "manifest"
    "channel": "stable",               // future: "beta" | "lts"
    "installMethod": "auto",           // "auto" | "git" | "docker" | "npm" | "managed"
    "checkIntervalHours": 6,
    "maintenanceWindow": null,         // {"start":"03:00","end":"05:00","tz":"local"}
    "preApplyGraceMinutes": 15,
    "drainSeconds": 60,
    "rollbackHealthCheckSeconds": 60,
    "diskSpaceMinMB": 500,
    "githubRepo": "ether/etherpad",
    "trustedKeysPath": null            // override default trusted-key set for forks
  },
  "adminEmail": null                   // top-level. Contact address for admin notifications
                                       // (updates, future security advisories, etc.). Used by
                                       // the updater; reusable by other features later.
}
```

Shipped defaults:

- `settings.json.template`: `tier: "notify"`. Fresh installs get the banner with no manual config.
- `settings.json.docker`: `tier: "notify"`, `installMethod: "docker"` (explicit, even though detector would catch it — clearer in policy logs).

The whole `updates` block is optional. Existing installs upgrading to the version that ships PR 1 will start showing the banner with no config change. This is called out in `CHANGELOG.md` and the release notes; admins who want the old behavior set `tier: "off"`.

### Email notifications (`adminEmail`)

`adminEmail` is a top-level setting (not under `updates`) so other features — security advisories, plugin alerts, future operational notifications — can reuse it. The updater is the first consumer.

If `adminEmail` is unset, the updater never sends mail; banners and logs still work. If set, the existing SMTP path Etherpad already uses for invite/notification plugins delivers the message.

Triggers and cadence (deduped state lives in `var/update-state.json` under `email.lastSentFor`):

| Trigger | First send | Repeat |
|---|---|---|
| New release detected while running a `vulnerable` version | immediate | weekly while still `vulnerable` |
| Instance enters `severe` (>= 1 major behind) | immediate | monthly while still `severe` |
| Tier 3 grace window starts | every grace start | n/a (one event per scheduled update) |
| `rollback-failed` terminal state entered | immediate | n/a (one event per entry) |

Successful updates do not generate email — that is noise. The admin UI banner is sufficient for non-urgent state.

Cadence is per-status, not per-tick: if a `severe` instance also becomes `vulnerable`, the vulnerable cadence applies until vulnerability clears, then the severe cadence resumes.

## Data flow

### Boot sequence (every tier)

1. `InstallMethodDetector.detect()` — caches result.
2. `RollbackHandler.checkPendingVerification()` — if previous boot was an update, arm the 60s health-check timer; on success mark `verified`; on timeout/failure trigger rollback and exit 75. Increment `bootCount`; if it exceeds 2, force rollback regardless of timer.
3. `VersionChecker.start()` — immediate first check, then interval.

### Tier 1 — notify

`VersionChecker` updates `var/update-state.json`. `GET /admin/update/status` reads it. `GET /api/version-status` reads it. No execution path.

### Tier 2 — manual click

```
admin click
  → POST /admin/update/apply (admin auth + CSRF)
  → UpdatePolicy.canManual() — abort if false
  → SessionDrainer.start() (broadcast at T-60/-30/-10, refuse new connections)
  → UpdateExecutor.run()
      ├─ snapshot SHA + pnpm-lock.yaml to var/update-backup/
      ├─ verify release tag signature
      ├─ git fetch, git checkout <tag>
      ├─ pnpm install --frozen-lockfile
      ├─ pnpm run build:ui
      ├─ write update-state.json: status=pending-verification, from=<sha>, to=<tag>, bootCount=0
      └─ exit 75
  → supervisor restarts → boot sequence runs RollbackHandler
```

### Tier 3 — auto (admin-opted-in)

Same pipeline as tier 2, but the trigger is `VersionChecker` detecting a new release while `UpdatePolicy.canAuto()` returns true. Before the drain starts, a `preApplyGraceMinutes` window opens during which the admin can cancel via `/admin/update/cancel`. Pending-update info is persisted so a restart during the grace window doesn't lose the schedule. Optional email notification at grace start.

### Tier 4 — autonomous

Same as tier 3, but `Scheduler` only schedules when `now()` is inside `maintenanceWindow`. If the window closes while an update is mid-grace, the update is deferred to the next window (drain does not start outside the window).

## Error handling

### Pre-flight checks

Run before `UpdateExecutor` modifies anything. Any failure aborts cleanly.

- `installMethod` allows execution.
- Git working tree clean — admin patches are not silently clobbered.
- Git remote `origin` reachable and target tag exists.
- Target tag's signature verifies against trusted-key set.
- Free disk space ≥ `diskSpaceMinMB`.
- `pnpm` resolvable on `PATH`.
- `var/update.lock` not held (or stale).
- Tier 4 only: currently inside maintenance window.

On failure: write `update-state.json` with `status: "preflight-failed"`, log to `update.log`, surface in admin UI banner. No rollback needed because nothing changed.

### Failure modes during execution

| Stage | Failure | Behavior |
|---|---|---|
| `git fetch` | network | abort, no state change, status = `preflight-failed` |
| `git checkout` | conflict / dirty tree | abort, status = `preflight-failed` |
| `pnpm install` | resolver/network/disk | rollback: restore SHA + lockfile, retry `pnpm install`. Status = `rolled-back-install-failed` |
| `pnpm run build:ui` | build error | same rollback. Status = `rolled-back-build-failed` |
| `exit 75` | — | success path. Status = `pending-verification` |
| Boot crash loop | new version crashes repeatedly | RollbackHandler sees `bootCount > 2`, forces rollback. Status = `rolled-back-crash-loop` |
| Health check fails in 60s | new version starts but `/health` doesn't 200 | RollbackHandler timer fires, restores prior state. Status = `rolled-back-health-check` |
| Rollback itself fails | restore-time `pnpm install` errors | terminal state. Status = `rollback-failed`. Big red banner, refuse further auto/autonomous attempts until admin acknowledges. Email if SMTP configured. |

### State machine

```
        idle
         │ (admin click / autonomous trigger)
         ▼
    preflight ──fail──► preflight-failed ──ack──► idle
         │
         ▼
     draining ──cancel──► idle
         │
         ▼
     executing ──install/build fail──► rolling-back ──► rolled-back-* ──ack──► idle
         │                                   │
         ▼                                   └─fail──► rollback-failed (terminal until ack)
   pending-verification ──health-check fail──┘
         │
         ▼ verified by health check
       verified ──► idle
```

`rollback-failed` is the only state that disables auto/autonomous attempts globally until an admin POSTs `/admin/update/acknowledge`. Manual updates remain allowed because an admin can intervene directly.

### Logging

- All updater activity → `var/log/update.log` (rotated, 10MB × 5).
- `GET /admin/update/log` streams the last 200 lines for the in-progress UI.
- Important state transitions also written to log4js category `updater` at INFO so they appear in normal Etherpad logs.

## Security

- Admin endpoints share existing auth path (`webaccess.ts`, basic auth + admin role). State-changing endpoints require CSRF tokens.
- Tag signature verification before checkout. Trusted-key set ships in `src/node/updater/trusted-keys.ts`. Forks override via `updates.trustedKeysPath`. Failure → `preflight-failed: signature`.
- Update execution runs as Etherpad's OS user. No privilege escalation. Pre-flight permissions probe catches setups where `pnpm install` would need root.
- `GET /api/version-status` deliberately does not return the running version. Returning `severe` or `vulnerable` to attackers without confirming exact version makes fingerprinting strictly harder than it is today, where a `/static/js/...` path or response header may already leak it.
- Concurrent-update prevention via PID-based `var/update.lock`.
- No telemetry. The only outbound traffic is to `api.github.com` (or the configured `updates.githubRepo` host). No instance ID, no version, no identifiers — just the IP-level metadata GitHub already sees.
- Public `/api/version-status` rate-limited by an in-memory cache refreshed at most once per minute.

## Testing

### Unit (`src/tests/backend/specs/updater/`, vitest, no I/O)

- `UpdatePolicy.test.ts` — full `(installMethod × tier × current/latest)` matrix.
- `VersionChecker.test.ts` — mocked `fetch`. ETag, backoff, parsing of `vulnerable-below` directives, `prerelease` filtering.
- `InstallMethodDetector.test.ts` — fake fs.
- `RollbackHandler.test.ts` — fake state file + clock + spawn. State-machine transitions, crash-loop guard, terminal `rollback-failed`.
- `MaintenanceWindow.test.ts` — cross-midnight, DST.

### Integration (`src/tests/backend/specs/updater-integration.test.ts`)

- Tmp git repo as the "Etherpad install."
- Local HTTP server impersonating GitHub Releases.
- Cases: happy path; install-fail rollback; build-fail rollback; health-check timeout rollback; crash-loop rollback (force `bootCount` to 3); `rollback-failed` terminal blocks auto/autonomous but allows manual.

### API tests

- `GET /admin/update/status` — auth required, schema, expected fields.
- `POST /admin/update/apply` — admin-only, CSRF, refuses on lock/policy denial.
- `POST /admin/update/cancel` — works during pre-execute, 409 during execute.
- `POST /admin/update/acknowledge` — clears terminal state.
- `GET /api/version-status` — public, never leaks version string.

### Playwright (`src/tests/frontend-new/specs/`, headless)

- Update banner appears on `/admin` when an update exists.
- UpdatePage shows version, changelog, Apply button.
- Click triggers `POST /admin/update/apply`, log stream visible.
- Banner copy correct for each terminal state.
- Maintenance-window picker validates inputs.
- Pad footer badge: invisible on `null`, discreet on `severe`, prominent on `vulnerable`.
- Drain announcement appears in pad chat at T-60, T-30, T-10.

### Out of CI (manual smoke)

- Real-network GitHub calls.
- Real process restart with a real supervisor.
- Real `pnpm install` of a different version.

These are covered by:

- A manual smoke runbook in `docs/superpowers/specs/2026-04-25-auto-update-runbook.md` (created during PR 2 implementation), run before each tier ships, against a disposable VM.
- A canary instance running `tier: "auto"` against a beta channel for ≥ 2 weeks before tier 4 ships.

### Test coverage gates per PR

- **PR 1:** VersionChecker, InstallMethodDetector, UpdatePolicy, Notifier unit + status endpoint API + banner Playwright + pad badge Playwright.
- **PR 2:** + UpdateExecutor + RollbackHandler unit + integration (all rollback paths) + apply/cancel/acknowledge API + UpdatePage Playwright. Runbook smoke completed by a human on a disposable VM.
- **PR 3:** + Scheduler unit + grace-window integration + cancel-during-grace test.
- **PR 4:** + MaintenanceWindow unit + window-boundary integration. Canary on beta channel for 2 weeks before merge.

## Phased rollout

Each PR is independently shippable, independently revertable, and gated by `updates.tier`.

### PR 1 — Tier 1: Notify

- `src/node/updater/{VersionChecker,InstallMethodDetector,UpdatePolicy,state}.ts`
- `src/node/updater/Notifier.ts` — single entry point for updater emails. Reads top-level `adminEmail`. Implements the cadence table (immediate-then-weekly for vulnerable, immediate-then-monthly for severe). Persists `email.lastSentFor` in `var/update-state.json` to dedupe. No-op if `adminEmail` unset.
- `src/node/hooks/express/updateStatus.ts` registering `GET /admin/update/status` and `GET /api/version-status`.
- Settings additions in `settings.json.template` and `settings.json.docker`, including new top-level `adminEmail`.
- Admin UI: `UpdatePage.tsx` (read-only), `UpdateBanner.tsx`, route entry, i18n.
- Pad UI: footer badge.
- Tests per PR 1 row above, plus `Notifier.test.ts` (cadence math, dedupe, no-op when `adminEmail` unset).
- `CHANGELOG.md` entry.

**Ship gate:** unit + API + Playwright pass; manual smoke confirms banner appears when version is patched downward.

### PR 2 — Tier 2: Manual click

- `src/node/updater/{UpdateExecutor,RollbackHandler,SessionDrainer,lock,trusted-keys}.ts`
- Endpoints: `POST /admin/update/apply`, `POST /admin/update/cancel`, `POST /admin/update/acknowledge`, `GET /admin/update/log`.
- `UpdatePolicy` flips `canManual` on for `git` install method.
- Admin UI: Apply button, log stream, terminal-state banners, Cancel during pre-execute, Acknowledge on terminal.
- Drain announcement i18n.
- Tests per PR 2 row.
- Manual smoke runbook updated and run end-to-end on a disposable VM, including a deliberately broken-lockfile rollback.

**Ship gate:** integration tests pass for all rollback paths; runbook smoke completed by a human.

### PR 3 — Tier 3: Auto

- `src/node/updater/Scheduler.ts` — listens to `VersionChecker` events, applies grace window, persists pending-update info.
- `UpdatePolicy.canAuto` flips on for `git` + `tier: "auto"`.
- Email notification at grace start (existing SMTP, only if `adminEmail` is set).
- Admin UI: countdown + cancel during grace.
- Tests per PR 3 row.

**Ship gate:** scheduler tests pass; canary running `tier: "auto"` against a beta channel for 2 weeks.

### PR 4 — Tier 4: Autonomous

- `src/node/updater/MaintenanceWindow.ts`.
- `Scheduler` learns to gate on the window. Updates outside the window queue for the next opening.
- `UpdatePolicy.canAutonomous` flips on for `git` + `tier: "autonomous"` + valid window.
- Admin UI: window picker, validation, "next window opens at..." preview.
- Tests per PR 4 row.

**Ship gate:** window unit tests pass; canary switched to `tier: "autonomous"` on the beta channel for 2 weeks.

### Cross-cutting

- **Plugin seam:** `UpdatePolicy` and `VersionChecker` take a `target: 'core' | 'plugins'` parameter from PR 1. Plugin support is not implemented in this spec but the API does not paint us into a corner.
- **Telemetry:** none. Stated explicitly here so it is not silently added later.
- **Docs:** PR 1 introduces `doc/admin/updates.md`; subsequent PRs extend it.

## Open questions

None at spec time. Concrete questions that may surface during implementation are expected to land in PR review, not here.
