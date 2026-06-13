# Etherpad updates

Etherpad ships with a built-in update subsystem.

- **Tier 1 (notify)** — default. A banner appears in the admin UI when a new release is available, and pad users see a dismissable gritter notification if the running version is at least one minor version behind the latest release. No execution.
- **Tier 2 (manual click)** — admins on a git install can click "Apply update" at `/admin/update`. Etherpad drains active sessions, runs `git fetch / checkout / pnpm install / pnpm run build:ui`, and exits with code 75 so a process supervisor restarts it on the new version. Auto-rolls back on failure.
- **Tier 3 (auto with grace window)** — opt-in. On a git install, a newly detected release transitions execution state to `scheduled` and is applied after `preApplyGraceMinutes`. During the grace window, `/admin/update` shows a live countdown plus Cancel and Apply now buttons; an admin email (if `adminEmail` is set) fires once per scheduled tag.
- **Tier 4 (autonomous in maintenance window)** — opt-in. Tier 3 + `updates.maintenanceWindow` is required; the scheduler only fires while the wall clock is inside the configured window. Updates detected outside the window queue for the next opening.

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
  "adminEmail": null,
  // SMTP transport for the admin notification emails. host=null keeps
  // log-only behaviour ("(would send email)"); set host+from to deliver.
  "mail": {
    "host": null,
    "port": 587,
    "secure": false,
    "from": null,
    "auth": null
  }
}
```

| Setting | Default | Notes |
| --- | --- | --- |
| `updates.tier` | `"notify"` | One of `"off"`, `"notify"`, `"manual"`, `"auto"`, `"autonomous"`. All tiers are implemented. Higher tiers are silently downgraded if the install method does not allow them (only `"git"` installs can run the write tiers `manual` / `auto` / `autonomous`). |
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
| `mail.host` | `null` | Top-level SMTP host. **`null` keeps log-only behaviour** — notifications are logged as `(would send email)` and never delivered. Set a host (and `mail.from`) to deliver over SMTP via nodemailer. The `nodemailer` dependency is lazy-loaded, so installs that leave `mail.host` unset pay no runtime cost. |
| `mail.port` | `587` | SMTP port. |
| `mail.secure` | `false` | `true` for an implicit-TLS connection (typically port 465); `false` uses STARTTLS upgrade when offered. |
| `mail.from` | `null` | Envelope/From address. **Required for delivery** — if `mail.from` is unset (even with a host) the updater falls back to log-only `(would send email)`. |
| `mail.auth` | `null` | SMTP credentials object `{ "user": "...", "pass": "..." }`, passed through to nodemailer. Leave `null` for unauthenticated relays. |

## What "outdated" means

- **`minor`** — the running server is at least one minor version behind the latest published release. Patch-only deltas (same major and minor, higher patch) do not fire the notice.

## Email cadence (when `adminEmail` is set)

These are the "nudge" emails sent by the periodic checker when the instance is behind:

| Trigger | First send | Repeat |
| --- | --- | --- |
| Outdated (minor or more behind) detected | Immediate | Every 30 days while still outdated (`SEVERE_INTERVAL`) |
| Up to date | No email | — |

The write tiers also email about **apply outcomes** so admins learn about failures without watching the UI:

| Outcome | When | Dedupe |
| --- | --- | --- |
| `update-preflight-failed` | An auto/autonomous apply was blocked at preflight (e.g. `node-engine-mismatch`, dirty tree, low disk). Subject: *Auto-update to `<tag>` blocked at preflight*. | Deduped on `<outcome>:<targetTag>` — one email per outcome per target tag. |
| `update-rolled-back` | An apply failed mid-flow and Etherpad auto-recovered to the previous version. Subject: *Auto-update to `<tag>` rolled back*. | Deduped on `<outcome>:<targetTag>`. |
| `update-rollback-failed` | **Terminal.** The apply failed *and* the rollback failed — manual intervention required. Subject: *Auto-update FAILED and could not be rolled back — manual intervention required*. | **Always sends**, bypassing dedupe, because the admin must learn about it even if a transient failure shared the same key. |

A different outcome or a different target tag resets the dedupe key and fires a fresh email. Manual (Tier 2) failures surface in the admin UI banner; the outcome emails are tied to the auto/autonomous flows.

If `adminEmail` is unset, the updater never sends mail. The admin UI banner and the pad-side notice still work without it.

SMTP delivery is wired via [nodemailer](https://nodemailer.com/) (lazy-loaded). When `mail.host` and `mail.from` are both set, emails are delivered over SMTP. When either is unset the updater falls back to logging each message as `(would send email)` — the dedupe state still advances correctly, so admins are not bombarded once SMTP is configured. An SMTP send failure is caught and logged (`email send failed: …`) and never disrupts the updater state machine.

## Pad-side notice

Pad users see no version information by default. A dismissable gritter notification appears only when:

- The running server is at least one minor version behind the latest published release (patch-only deltas do not fire), **and**
- The requesting user is the first author of the pad.

The notice auto-fades after 8 seconds and can be dismissed immediately. The public endpoint `/api/version-status` accepts an optional `?padId=<id>` query parameter and returns `{outdated: "minor" | null, isFirstAuthor: boolean}` — it never leaks the running version, so attackers do not gain a fingerprint vector. Results are cached per `(padId, authorId)` for 60 seconds.

## Disabling everything

Set `updates.tier` to `"off"`. The self-updater goes silent — no request to the GitHub Releases API leaves the instance and no banner or badge renders. Note this does **not** cover the separate legacy version check in `UpdateCheck.ts`, which still fetches `${updateServer}/info.json` until you also set `privacy.updateCheck` to `false` (see [PRIVACY.md](https://github.com/ether/etherpad/blob/develop/PRIVACY.md)).

On Docker / air-gapped installs you can do both without editing `settings.json` inside the image by setting `UPDATES_TIER=off` **and** `PRIVACY_UPDATE_CHECK=false` (add `PRIVACY_PLUGIN_CATALOG=false` to also disable the admin plugin browser's catalogue fetch). See the [Updates & privacy](../docker.md#updates--privacy-offline--air-gapped) table in the Docker docs for the full set of environment variables.

## Privacy

The version check sends no telemetry. Etherpad fetches the public GitHub Releases API (`api.github.com/repos/<repo>/releases/latest`) with `If-None-Match` to be cache-friendly. The only metadata GitHub sees is the same as any other GitHub API client — your IP and a `User-Agent: etherpad-self-update` header. No instance ID, no version, no identifiers travel upstream.

## How install method is detected

`updates.installMethod` defaults to `"auto"`, which uses these heuristics in order:

1. `/.dockerenv` exists → `"docker"`.
2. `.git/` directory present and the install root is writable → `"git"`.
3. `package-lock.json` present and writable → `"npm"`.
4. Otherwise → `"managed"`.

Set the value explicitly if the heuristics get it wrong (e.g., a docker container that bind-mounts a writable git checkout).

Every install method gets the Tier 1 banner. The install method gates whether the write tiers (manual click, auto, autonomous) can run: only `"git"` installs are supported for the write tiers — other methods are silently downgraded to notify.

## Tier 2 — manual click

Tier 2 is opt-in. To enable: set `updates.tier: "manual"` and ensure your install was deployed via git (not docker / npm / managed package).

### Process supervisor is required

Etherpad applies an update by **exiting with code 75** so a process supervisor restarts it. Without a supervisor the instance simply exits and stays down. Common supervisor setups:

- **systemd:** add `Restart=on-failure` + `RestartSec=5` to your unit file.
- **pm2:** the default behaviour restarts on exit.
- **docker:** add `--restart=unless-stopped` (Tier 2 itself is not supported on docker installs anyway, but if you wrap your own image around a git checkout this applies).

### What clicking "Apply update" does

1. **Lock acquire** — `var/update.lock` (PID-based, stale locks reaped automatically).
2. **Pre-flight checks** — install method writable, working tree clean, free disk ≥ `diskSpaceMinMB`, `pnpm` on `PATH`, no lock held, target tag exists at the configured remote, signature verifies (if `requireSignature: true`), and the target's Node engine matches the running Node. The Node-engine check runs *after* signature verification (so the `engines.node` range comes from a trusted tag): Etherpad reads `engines.node` from the target tag's `package.json` via `git show <tag>:package.json` and refuses the update via `semver.satisfies` if the running Node does not satisfy it. On failure, state goes to `preflight-failed` with a typed reason; the admin sees a banner and clicks **Acknowledge** to clear it. No filesystem mutation has happened — nothing to roll back.
3. **Drain** — `drainSeconds` window during which T-60 / T-30 / T-10 announcements broadcast to every connected pad and new socket connections are refused. Click **Cancel** during this window to abort cleanly.
4. **Execute** — `git fetch --tags origin`, `git checkout <tag>`, `pnpm install --frozen-lockfile`, `pnpm run build:ui`. Output streams to `var/log/update.log` (rotated 10 MB × 5).
5. **Exit 75** — the supervisor restarts on the new version.
6. **Health check** — RollbackHandler arms a `rollbackHealthCheckSeconds` timer at boot. When `/health` responds 200 (i.e., Etherpad reaches the `RUNNING` state) the timer cancels and the state lands on `verified`.

### Failure modes

| What went wrong | Resulting state | Admin action |
| --- | --- | --- |
| Pre-flight check fails | `preflight-failed` | Click **Acknowledge** after fixing the underlying issue (free up disk, clean working tree, etc.). |
| Target tag requires a newer (or different) Node than the one running | `preflight-failed` (reason `node-engine-mismatch`) | Fails cleanly at preflight with a detail like *"target requires Node >=X, running Y"*. No drain, no `git checkout`, no restart, nothing to roll back — the install is untouched. Upgrade Node to a version that satisfies the target's `engines.node`, then **Acknowledge** and retry. |
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

with the `scheduledFor` timestamp. Delivery follows the same SMTP path as every other notification: when `mail.host` and `mail.from` are set the message is sent via nodemailer, otherwise it logs as `(would send email)`. Cadence and dedupe update correctly either way.

The right way to give docker admins an in-product Apply button is to delegate to the orchestrator rather than mutate the container. Two patterns to consider in a follow-up PR:

- **Instructions-only.** When the page detects `installMethod: docker` *and* a newer release exists, swap the policy-denial copy for actionable instructions (`docker pull etherpad/etherpad:<tag>` for plain docker; `docker compose pull && docker compose up -d` for compose). Cheap, no new attack surface.
- **Deploy webhook.** New setting `updates.dockerWebhook`. When set, the Apply button on a docker install POSTs to the configured URL and trusts the orchestrator (Render / Railway / Fly / Portainer / Coolify / GitHub Actions — they all expose redeploy webhooks) to do the actual pull-and-recreate.

Direct Docker-socket access (mount `/var/run/docker.sock` into the container) is **out of scope** — anyone who escapes the Etherpad process via that socket gets root on the host. Admins who want fully autonomous docker updates should run [Watchtower](https://containrrr.dev/watchtower/) alongside Etherpad rather than bake equivalent privilege into Etherpad itself.

## Tier 4 — autonomous in a maintenance window

Tier 4 layers a wall-clock window on top of Tier 3 so autonomous updates only run while it is safe to drain sessions (typically nightly).

To enable, on a git install:

```jsonc
{
  "updates": {
    "tier": "autonomous",
    "preApplyGraceMinutes": 15,
    "maintenanceWindow": { "start": "03:00", "end": "05:00", "tz": "local" }
  }
}
```

`start` and `end` are 24-hour `HH:MM` wall-clock times in the configured `tz` (`"local"` or `"utc"`). `end` is exclusive; `end < start` denotes a cross-midnight window (`22:00–02:00` runs from 22:00 through 01:59).

### How the window gate works

1. `evaluatePolicy` returns `canAutonomous: true` only when the install is `git`, tier is `"autonomous"`, no terminal `rollback-failed` is set, and `updates.maintenanceWindow` is set and parse-valid. Missing/malformed windows return `canAutonomous: false` with `policy.reason` equal to `maintenance-window-missing` / `maintenance-window-invalid`, and the rest of the policy degrades to Tier 3 (`canAuto: true`). An admin banner surfaces the misconfiguration so the autonomous behavior is never silently disabled.
2. When the scheduler picks up a new release while `canAutonomous: true`, it computes `scheduledFor = now + preApplyGraceMinutes`. If that timestamp falls **outside** the window, it is snapped forward to the **next opening** of the window.
3. When the timer fires, the scheduler re-checks the clock. If the window has already closed (long grace, clock skew, host suspend), the fire is **deferred**: `var/update-state.json` is updated with a new `scheduledFor` pointing at the next opening, the timer is re-armed, and the actual apply runs at the next valid moment.

### DST and timezone notes

- `tz: "utc"` is recommended for hosts running across DST boundaries — the window is interpreted against the same wall clock every day of the year.
- `tz: "local"` follows the host's local time. On DST spring-forward days, a window starting at a non-existent local time (e.g. `02:30` in `America/New_York` on the second Sunday of March) silently lands at the next valid wall-clock minute via the host JS `Date` constructor's normalization. On fall-back days, the first occurrence of the wall-clock start time is used.
- Cross-midnight windows (`end < start`) span at most 24 hours; longer "windows" should be split into two settings, e.g. by running Tier 3 instead.

### Admin UI

`/admin/update` shows a "Maintenance window" section when `updates.tier == "autonomous"`:

- Configured: summary `HH:MM–HH:MM (tz)` plus "Next window opens at …".
- Not configured: a clear "Not configured" message and a top-of-page banner that links back to the page.
- During a deferred-grace schedule, the scheduled panel shows both the countdown to `scheduledFor` and an explanatory "Outside maintenance window. Update will start when the window opens at …" line.

Admins edit `updates.maintenanceWindow` via the parsed JSONC settings editor at `/admin/settings`. Saving an invalid shape is caught at boot — the warning is logged via the `updater` log4js category and the policy downgrades to Tier 3.
