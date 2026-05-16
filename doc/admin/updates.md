# Etherpad updates

Etherpad ships with a built-in update subsystem.

- **Tier 1 (notify)** — default. A banner appears in the admin UI when a new release is available, and pad users see a discreet badge if the running version is severely outdated or flagged as vulnerable. No execution.
- **Tier 2 (manual click)** — admins on a git install can click "Apply update" at `/admin/update`. Etherpad drains active sessions, runs `git fetch / checkout / pnpm install / pnpm run build:ui`, and exits with code 75 so a process supervisor restarts it on the new version. Auto-rolls back on failure.
- **Tier 3 (auto with grace window)** — opt-in. On a git install, a newly detected release transitions execution state to `scheduled` and is applied after `preApplyGraceMinutes`. During the grace window, `/admin/update` shows a live countdown plus Cancel and Apply now buttons; an admin email (if `adminEmail` is set) fires once per scheduled tag.
- **Tier 4 (autonomous in maintenance window)** — designed, not yet implemented.

## Settings

In `settings.json`:

```jsonc
{
  "updates": {
    "tier": "notify",
    "source": "github",
    "channel": "stable",
    "installMethod": "auto",
    "checkIntervalHours": 6,
    "githubRepo": "ether/etherpad",
    "requireAdminForStatus": false,
    // Tier 2+ knobs (only meaningful at tier "manual" or higher):
    "preApplyGraceMinutes": 0,
    "drainSeconds": 60,
    "rollbackHealthCheckSeconds": 60,
    "diskSpaceMinMB": 500,
    "requireSignature": false,
    "trustedKeysPath": null
  },
  "adminEmail": null
}
```

| Setting | Default | Notes |
| --- | --- | --- |
| `updates.tier` | `"notify"` | One of `"off"`, `"notify"`, `"manual"`, `"auto"`, `"autonomous"`. Higher tiers are silently downgraded if the install method does not allow them. PR 1 only honors `"notify"` and `"off"`. |
| `updates.source` | `"github"` | Reserved for future alternative sources. Only `"github"` is implemented. |
| `updates.channel` | `"stable"` | Reserved. Stable releases only. |
| `updates.installMethod` | `"auto"` | One of `"auto"`, `"git"`, `"docker"`, `"npm"`, `"managed"`. Auto-detects via filesystem heuristics. Set explicitly to override. |
| `updates.checkIntervalHours` | `6` | How often to poll GitHub Releases. |
| `updates.githubRepo` | `"ether/etherpad"` | Override for forks. |
| `updates.requireAdminForStatus` | `false` | Lock the `/admin/update/status` endpoint to authenticated admin sessions. Default `false` matches existing Etherpad behavior — `/health` already exposes `releaseId` publicly, and changelog data comes from a public GitHub release. Set `true` to hide the full update payload from non-admins without disabling the updater (`tier: "off"` is the heavier opt-out that removes the endpoints entirely). |
| `updates.preApplyGraceMinutes` | `0` | **Tier 3 only.** Wait this many minutes between detecting a new release and starting the drain so the admin can cancel via `/admin/update`. `0` applies immediately when allowed. Clamped to `[0, 7*24*60]` (one week). Has no effect at tier `"manual"`. |
| `updates.drainSeconds` | `60` | How long to broadcast "restart imminent" announcements to active pads before exiting. T-60 / T-30 / T-10 broadcasts fire automatically at the matching offsets within this window. |
| `updates.rollbackHealthCheckSeconds` | `60` | After a fresh boot post-update, give `/health` this long to come up. If it doesn't, RollbackHandler restores the previous SHA. |
| `updates.diskSpaceMinMB` | `500` | Pre-flight refuses to start an update unless the install volume has at least this many MB free. |
| `updates.requireSignature` | `false` | When `true`, refuse updates whose tag is not signed by a trusted key. Verification is done via `git verify-tag <tag>` against the user's GPG keyring. Default `false` because Etherpad's release process does not yet sign tags consistently — turning the check on by default would block every Tier 2 update. Set `true` if you run your own builds or have imported a fork's keys. |
| `updates.trustedKeysPath` | `null` | Override the keyring location passed to `git verify-tag` via the `$GNUPGHOME` env var. Useful when the trusted keys live in a dedicated keyring outside the Etherpad user's home. Only meaningful when `requireSignature: true`. |
| `adminEmail` | `null` | Top-level. Contact for admin notifications. Setting it enables the email nudges below. |

## What "outdated" means

- **`severe`** — running at least one major version behind the latest release.
- **`vulnerable`** — the running version is below a `vulnerable-below` threshold announced in a recent release. Releases declare these via a `<!-- updater: vulnerable-below X.Y.Z -->` HTML comment in their body. The newest such directive wins.

## Email cadence (when `adminEmail` is set)

| Trigger | First send | Repeat |
| --- | --- | --- |
| Vulnerable status detected | Immediate | Weekly while still vulnerable |
| New release announced while still vulnerable | Immediate | n/a (one event per tag change) |
| Severely outdated detected | Immediate | Monthly while still severely outdated |
| Up to date | No email | — |

If `adminEmail` is unset, the updater never sends mail. The admin UI banner and the pad-side badge still work without it.

PR 1 ships the cadence machinery but does not yet wire a real SMTP transport — emails are logged with `(would send email)` until a future PR adds the transport. The dedupe state still advances correctly so admins are not bombarded once SMTP is wired.

## Pad-side badge

Pad users see no version information by default. A small badge appears in the bottom-right corner only when:

- The instance is `severe` (one or more major versions behind), or
- The instance is `vulnerable` (running below an announced threshold).

The public endpoint `/api/version-status` returns only `{outdated: null|"severe"|"vulnerable"}` — it never leaks the running version, so attackers do not gain a fingerprint vector.

## Disabling everything

Set `updates.tier` to `"off"`. No HTTP request will leave the instance and no banner or badge will render.

## Privacy

The version check sends no telemetry. Etherpad fetches the public GitHub Releases API (`api.github.com/repos/<repo>/releases/latest`) with `If-None-Match` to be cache-friendly. The only metadata GitHub sees is the same as any other GitHub API client — your IP and a `User-Agent: etherpad-self-update` header. No instance ID, no version, no identifiers travel upstream.

## How install method is detected

`updates.installMethod` defaults to `"auto"`, which uses these heuristics in order:

1. `/.dockerenv` exists → `"docker"`.
2. `.git/` directory present and the install root is writable → `"git"`.
3. `package-lock.json` present and writable → `"npm"`.
4. Otherwise → `"managed"`.

Set the value explicitly if the heuristics get it wrong (e.g., a docker container that bind-mounts a writable git checkout).

In PR 1 (notify only) the install method does not change behavior — every install method gets the banner. From PR 2 onward the install method gates whether the manual-click and automatic tiers can run; only `"git"` is initially supported for write tiers.

## Tier 2 — manual click

Tier 2 is opt-in. To enable: set `updates.tier: "manual"` and ensure your install was deployed via git (not docker / npm / managed package).

### Process supervisor is required

Etherpad applies an update by **exiting with code 75** so a process supervisor restarts it. Without a supervisor the instance simply exits and stays down. Common supervisor setups:

- **systemd:** add `Restart=on-failure` + `RestartSec=5` to your unit file.
- **pm2:** the default behaviour restarts on exit.
- **docker:** add `--restart=unless-stopped` (Tier 2 itself is not supported on docker installs anyway, but if you wrap your own image around a git checkout this applies).

### What clicking "Apply update" does

1. **Lock acquire** — `var/update.lock` (PID-based, stale locks reaped automatically).
2. **Pre-flight checks** — install method writable, working tree clean, free disk ≥ `diskSpaceMinMB`, `pnpm` on `PATH`, target tag exists at the configured remote, signature verifies (if `requireSignature: true`). On failure, state goes to `preflight-failed` with a typed reason; the admin sees a banner and clicks **Acknowledge** to clear it. No filesystem mutation has happened — nothing to roll back.
3. **Drain** — `drainSeconds` window during which T-60 / T-30 / T-10 announcements broadcast to every connected pad and new socket connections are refused. Click **Cancel** during this window to abort cleanly.
4. **Execute** — `git fetch --tags origin`, `git checkout <tag>`, `pnpm install --frozen-lockfile`, `pnpm run build:ui`. Output streams to `var/log/update.log` (rotated 10 MB × 5).
5. **Exit 75** — the supervisor restarts on the new version.
6. **Health check** — RollbackHandler arms a `rollbackHealthCheckSeconds` timer at boot. When `/health` responds 200 (i.e., Etherpad reaches the `RUNNING` state) the timer cancels and the state lands on `verified`.

### Failure modes

| What went wrong | Resulting state | Admin action |
| --- | --- | --- |
| Pre-flight check fails | `preflight-failed` | Click **Acknowledge** after fixing the underlying issue (free up disk, clean working tree, etc.). |
| `git fetch` / `git checkout` fails mid-flow | `rolled-back` | Informational. The working tree is back where it started; click **Acknowledge** to clear. |
| `pnpm install` or `pnpm run build:ui` fails | `rolled-back` | Same as above. The lockfile and SHA are restored. |
| `/health` doesn't come up within `rollbackHealthCheckSeconds` | `rolled-back` | Same — RollbackHandler restores the previous SHA + lockfile and exits 75 again. |
| The new version crashes at boot more than twice (`bootCount > 2`) | `rolled-back` | Crash-loop guard kicks in regardless of the health-check timer. |
| Rollback itself fails (e.g., `pnpm install` errors restoring old lockfile) | `rollback-failed` | **Manual intervention required.** The admin banner switches to a strong red alert. Restore the install by hand, then click **Acknowledge** to clear the lock and re-allow Tier 2 attempts. |

### Endpoints

All Tier 2 endpoints require an authenticated admin session (`is_admin: true`) regardless of `requireAdminForStatus`.

- `POST /admin/update/apply` — start an apply. Returns `202 {accepted, drainEndsAt}` once the drain begins. Body unused.
- `POST /admin/update/cancel` — cancel during pre-flight or drain. Returns `409` once the executor has begun mutating the filesystem (state machine guarantees we either complete or roll back from there).
- `POST /admin/update/acknowledge` — clear a terminal `preflight-failed` / `rolled-back` / `rollback-failed` state back to `idle`.
- `GET /admin/update/log` — tail the last 200 lines of `var/log/update.log`. Plain text. Used by the in-progress UI.

### Signature verification

Default off. Etherpad releases are not yet consistently signed; turning verification on by default would block every Tier 2 update. To enable:

```jsonc
"updates": {
  "requireSignature": true,
  "trustedKeysPath": "/srv/etherpad/keys"   // optional — defaults to the OS user keyring
}
```

The check shells out to `git verify-tag <tag>`. The keyring at `trustedKeysPath` is passed to git via `GNUPGHOME`. If `trustedKeysPath` is `null` (default), the OS user's default keyring is used.

### Docker-friendly update flows (future work)

Tier 2 deliberately refuses to apply on `installMethod: "docker"` because in-container `git fetch / pnpm install / build:ui` doesn't survive a container restart — the orchestrator brings the container back up on the same image tag and the work is lost. Docker installs stay on Tier 1 (banner + version status) for now.

## Tier 3 — auto with grace window

Tier 3 builds on Tier 2 by scheduling the apply automatically when a new release is detected. The same `git fetch / checkout / pnpm install / build:ui / exit 75` pipeline runs — only the trigger changes.

To enable, on a git install: set `updates.tier: "auto"` and (optionally) `updates.preApplyGraceMinutes` to the grace duration you want.

### What happens when a new release lands

1. The periodic version checker (`updates.checkIntervalHours`) hits GitHub Releases.
2. If `policy.canAuto` is true (install is git, no terminal `rollback-failed` state, tier is `"auto"` or `"autonomous"`), the scheduler transitions `execution.status` to `scheduled` with `scheduledFor = now + preApplyGraceMinutes`.
3. The schedule is persisted to `var/update-state.json`, so an Etherpad restart inside the grace window rehydrates the timer rather than losing the schedule.
4. `/admin/update` shows a live countdown panel plus two buttons:
    - **Cancel** — `POST /admin/update/cancel` returns the state to `idle` and drops the in-process timer.
    - **Apply now** — `POST /admin/update/apply` skips the remaining grace; the regular Tier 2 pipeline runs immediately.
5. When the timer fires, the scheduler runs the exact same pipeline as a manual Tier 2 click: pre-flight → drain → execute → exit 75.

### Re-scheduling and stale state

- If a newer release tag appears while a schedule is pending, the scheduler re-arms the timer for the new tag. The `email.graceStartTag` dedupe field guards against duplicate `grace-start` notifications.
- If `updates.tier` is flipped back to `"manual"` or `"notify"` while a schedule is pending, the next periodic check cancels the schedule (state back to `idle`).
- `rollback-failed` disables Tier 3 globally. The admin must `POST /admin/update/acknowledge` (or visit `/admin/update` and click Acknowledge) before any further auto-schedules are armed. Tier 2 manual click stays available because the admin click *is* the intervention the terminal state requires.

### Email (`adminEmail` set)

A single `grace-start` notification fires per scheduled tag:

> [Etherpad] Auto-update scheduled for 2.7.2

with the `scheduledFor` timestamp. Etherpad core does not yet wire SMTP; the message logs as `(would send email)` until a future PR adds a transport. Cadence and dedupe still update correctly.

The right way to give docker admins an in-product Apply button is to delegate to the orchestrator rather than mutate the container. Two patterns to consider in a follow-up PR:

- **Instructions-only.** When the page detects `installMethod: docker` *and* a newer release exists, swap the policy-denial copy for actionable instructions (`docker pull etherpad/etherpad:<tag>` for plain docker; `docker compose pull && docker compose up -d` for compose). Cheap, no new attack surface.
- **Deploy webhook.** New setting `updates.dockerWebhook`. When set, the Apply button on a docker install POSTs to the configured URL and trusts the orchestrator (Render / Railway / Fly / Portainer / Coolify / GitHub Actions — they all expose redeploy webhooks) to do the actual pull-and-recreate.

Direct Docker-socket access (mount `/var/run/docker.sock` into the container) is **out of scope** — anyone who escapes the Etherpad process via that socket gets root on the host. Admins who want fully autonomous docker updates should run [Watchtower](https://containrrr.dev/watchtower/) alongside Etherpad rather than bake equivalent privilege into Etherpad itself.
