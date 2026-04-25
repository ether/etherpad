# Etherpad updates

Etherpad ships with a built-in update subsystem. **Tier 1 (notify)** is enabled by default: a banner appears in the admin UI when a new release is available, and pad users see a discreet badge if the running version is severely outdated or flagged as vulnerable. No automatic execution happens at this tier — admins are simply informed.

Tiers 2 (manual click), 3 (auto with grace window), and 4 (autonomous in maintenance window) are designed but not yet implemented. They will land in subsequent releases.

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
    "githubRepo": "ether/etherpad"
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
