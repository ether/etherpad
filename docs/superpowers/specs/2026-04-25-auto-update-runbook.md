# Etherpad Auto-Update — Manual Smoke Runbook

**Status:** required gate before each tier ships, per `2026-04-25-auto-update-design.md` § "Phased rollout".
**Audience:** the engineer cutting a release that includes new updater code.
**Time budget:** ~30–40 minutes for the full sweep against a disposable VM.

This runbook exercises the failure paths that unit and integration tests cannot reach: a real process supervisor, a real `pnpm install` run, real session drain broadcasts to a real pad client. Run it on a throw-away VM you don't mind nuking.

## 0. Provision a disposable VM

Anything Linux works; the example below uses Debian/Ubuntu under systemd.

```bash
# On the VM
sudo adduser --system --group --home /srv/etherpad --shell /bin/bash etherpad
sudo apt update && sudo apt install -y git nodejs ca-certificates
# Etherpad's pnpm comes from corepack — Node 22+ ships it.
sudo -u etherpad bash -c '
  cd /srv/etherpad
  git clone https://github.com/ether/etherpad.git current
  cd current
  corepack enable && corepack prepare pnpm@latest-9 --activate
  pnpm install
  pnpm run build:ui
'
```

## 1. Install Etherpad as a systemd service

`/etc/systemd/system/etherpad.service`:

```ini
[Unit]
Description=Etherpad
After=network.target

[Service]
Type=simple
User=etherpad
WorkingDirectory=/srv/etherpad/current
ExecStart=/usr/bin/pnpm run dev
Restart=on-failure
RestartSec=5
SuccessExitStatus=75
# Treat exit 75 as "intentional" so systemd doesn't escalate-restart counters.

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now etherpad
journalctl -u etherpad -f &  # tail the log in another terminal
```

## 2. Configure for Tier 2

Edit `/srv/etherpad/current/settings.json` and set:

```jsonc
{
  "updates": {
    "tier": "manual",
    "checkIntervalHours": 1,
    "drainSeconds": 30,                 // shorten the wait during smoke testing
    "rollbackHealthCheckSeconds": 30
  }
}
```

`sudo systemctl restart etherpad`. Visit `http://<vm-ip>:9001/admin/update` and log in as the admin user from `settings.json`.

## 3. Force "an update is available"

The simplest way: `git checkout` to a commit *before* a tagged release.

```bash
sudo -u etherpad bash -c 'cd /srv/etherpad/current && git checkout v2.7.2'
sudo systemctl restart etherpad
```

Trigger an immediate version check (or wait an hour):

```bash
curl -fsSL http://localhost:9001/admin/update/status | jq .
# Expect: latest.version newer than currentVersion, policy.canManual=true
```

The admin UI banner should now read **"Update available"**, and `/admin/update` should show an **"Apply update"** button.

## 4. Happy path: apply, drain, restart, verify

1. Open a pad in another browser tab (`http://<vm-ip>:9001/p/test`).
2. Click **Apply update** on `/admin/update`.
3. **Within 30 seconds** confirm:
   - The pad shows a gritter notification "Etherpad will restart in 30 seconds…" (i18n string from `update.drain.t30`), then `update.drain.t10`.
   - The page polls `/admin/update/log`; the `<pre>` block fills with `git fetch / checkout / pnpm install / pnpm run build:ui` output.
4. systemd journal shows `update executed: <fromSha> -> <tag>; exiting 75 for supervisor restart`.
5. systemd restarts the unit (~5s under `RestartSec`).
6. Reload `/admin/update`. State should be **`verified`** with `lastResult.outcome: "verified"`.

**Sign-off:** every observable transition matches the state machine in the design spec § "State machine". If any step lingers or the page shows a different status, capture `var/log/update.log` and stop.

## 5. Rollback path: install failure

Force a rollback by giving pnpm something it can't resolve.

```bash
# As etherpad user, in /srv/etherpad/current:
git checkout v2.7.2
echo 'lockfileVersion: this-is-not-real-content' >> pnpm-lock.yaml
sudo systemctl restart etherpad
```

Visit `/admin/update` and click Apply.

Expected:

- Drain announcement on the pad as before.
- Log shows `pnpm install --frozen-lockfile` exiting non-zero.
- State goes through `rolling-back` → `rolled-back`.
- After supervisor restart, `/admin/update` shows the **rolled-back** banner with `lastResult.reason` describing the install failure.
- `git rev-parse HEAD` matches the pre-update SHA.
- Click **Acknowledge** to clear the lastResult banner.

## 6. Rollback path: build failure

```bash
git checkout v2.7.2
# Break the build by introducing a syntax error:
echo 'this is not valid TypeScript' >> src/static/js/pad.ts
sudo systemctl restart etherpad   # confirm the broken tree still serves; we want apply to fail at build:ui, not at boot
```

Apply, observe `pnpm run build:ui` exit non-zero in the log, observe `rolling-back` → `rolled-back`. Working tree restored.

Revert the syntax error before continuing.

## 7. Crash-loop guard

Force the new version to crash at boot more than twice. Easiest:

```bash
# As etherpad user:
git checkout v2.7.2
# Apply to v2.7.3, but during the apply window introduce a startup error:
# (Edit src/node/server.ts in the v2.7.3 tag's worktree to throw immediately.)
```

Click Apply. The new boot crashes; systemd restarts; RollbackHandler increments `bootCount`. After three crashes, `bootCount > 2` triggers a forced rollback regardless of the health-check timer.

Observe state lands on `rolled-back` with `reason: "health-check-failed-or-crash-loop"`. Working tree on the original SHA.

## 8. Rollback-failed terminal state

Hardest to set up; force `pnpm install` to fail on the rollback path too.

```bash
# Trigger a normal install-failed rollback (step 5), but BEFORE it runs the
# rollback step, corrupt the backup lockfile:
echo garbage > /srv/etherpad/current/var/update-backup/pnpm-lock.yaml
# … or remove the etherpad user's permission to the install dir mid-flow.
```

Expected:

- State lands on **`rollback-failed`**.
- `/admin/update` shows the strong red banner (role=alert) with the
  `update.banner.terminal.rollback-failed` copy.
- `policy.canManual` stays true; `policy.canAuto` is false (terminal-blocked).
- Manually fix the install (restore the lockfile, fix permissions), then
  click **Acknowledge**. State returns to `idle` and Apply re-enables.

## 9. Cancel during drain

Click Apply. Within 30s, click Cancel.

Expected:

- Drain timers stop firing immediately.
- State returns to `idle`.
- `lastResult.outcome: "cancelled"`.
- `var/update.lock` is gone.
- No exit; systemd doesn't restart.

## 10. Sign-off checklist

Tick every line before approving the release that introduces this code:

- [ ] Happy path lands on `verified` with the working tree on the new tag.
- [ ] Install-fail and build-fail rollbacks restore the previous SHA.
- [ ] Crash-loop guard forces rollback at `bootCount > 2`.
- [ ] `rollback-failed` shows the strong banner and Acknowledge clears it.
- [ ] Cancel during drain leaves no lock, returns to `idle`.
- [ ] Pad client renders the localised drain announcement (NOT the literal i18n key).
- [ ] systemd journal shows no unhandled rejections, no orphaned processes.
- [ ] `var/log/update.log` is rotated when it crosses 10 MB (force this by writing >10 MB into the file and triggering an Apply).

If any line is unticked, do not ship the release.
