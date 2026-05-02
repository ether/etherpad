# Etherpad snap

Packages Etherpad as a [Snap](https://snapcraft.io/) for publishing to the
Snap Store.

- [User-facing usage](#user-facing-usage)
- [Architecture](#architecture)
- [Testing](#testing)
- [Development workflow](#development-workflow)
- [Publishing](#publishing)
- [Troubleshooting](#troubleshooting)

## User-facing usage

### Install from the store

```
sudo snap install etherpad
```

The default listen port is **9001**. Pad data lives in
`/var/snap/etherpad/common/` and survives `snap refresh`.

### Configure

The snap seeds `$SNAP_COMMON/etc/settings.json` from the upstream
template on first run. Edit that file directly to customise Etherpad,
then:

```
sudo snap restart etherpad
```

A few values are exposed as snap config so users don't have to edit the
file by hand:

| Key                            | Default   | Notes           |
| ------------------------------ | --------- | --------------- |
| `snap set etherpad port=9001`  | `9001`    | Listen port     |
| `snap set etherpad ip=0.0.0.0` | `0.0.0.0` | Bind address    |

The configure hook validates these (`port` must be 1–65535 integer,
`ip` must be a valid v4/v6 address) and restarts the daemon on change.

### Build locally

```
sudo snap install --classic snapcraft
sudo snap install lxd && sudo lxd init --auto
snapcraft            # from repo root; uses LXD by default
```

Output: `etherpad_<version>_<arch>.snap`.

### Install a local build

```
sudo snap install --dangerous ./etherpad_*.snap
sudo snap start etherpad
curl http://127.0.0.1:9001/health   # → {"status":"pass","releaseId":"X.Y.Z"}
```

Logs: `sudo snap logs etherpad -f`.

## Architecture

### File layout inside the snap

```
$SNAP/                                # = /snap/etherpad/current  (read-only squashfs)
├── opt/
│   ├── node/bin/node                 # pinned Node.js 22.12.0
│   └── etherpad/
│       ├── src/                      # ep_etherpad-lite workspace package (with node_modules incl. tsx)
│       ├── admin/, ui/, doc/         # other workspace packages (built artefacts)
│       ├── settings.json.template    # template, copied to $SNAP_COMMON on first run
│       └── var → /var/snap/etherpad/common/etherpad-app-var/   # symlink (see below)
├── bin/
│   ├── etherpad-service              # daemon launch wrapper
│   ├── etherpad-cli                  # passthrough to bin/ scripts
│   └── etherpad-healthcheck-wrapper  # HTTP /health probe
└── meta/snap.yaml

$SNAP_COMMON/                         # = /var/snap/etherpad/common  (read-write, persists across refreshes)
├── etc/settings.json                 # seeded from template on first run, never overwritten
├── var/etherpad.db                   # sqlite database
├── etherpad-app-var/installed_plugins.json   # plugin registry, written by Etherpad core
└── logs/                             # reserved for future use
```

### Why the `var/` symlink

Etherpad's plugin installer
(`src/static/js/pluginfw/installer.ts`) writes
`installed_plugins.json` via `__dirname`-relative paths, which resolve
to absolute paths inside `$SNAP` — read-only squashfs. Snap layouts
can't intercept paths inside `$SNAP`, so we replace the shipped `var/`
directory with a **symlink** at build time pointing to
`/var/snap/etherpad/common/etherpad-app-var/` (created by the wrapper
on first run). The kernel transparently follows the symlink to writable
storage that survives `snap refresh`.

### Why the seeded `settings.json` is rewritten

The upstream `settings.json.template` defaults to `dbType: "dirty"` —
the template itself warns this is dev-only. The launch wrapper rewrites
the seeded copy on first run to:

- `dbType: "sqlite"` with file at `$SNAP_COMMON/var/etherpad.db`
- `ip: "${IP:0.0.0.0}"` — Etherpad's own env-substitution syntax
- `port: "${PORT:9001}"` — same

The wrapper then exports `IP` and `PORT` from the snap config (via
`snapctl get`), so `snap set etherpad port=N` actually moves the
listener.

### Why pnpm runs twice

`pnpm install --frozen-lockfile --prod=false` first (need devDeps to
build admin/ui/docs), then `rm -rf node_modules && pnpm install --prod
--frozen-lockfile --ignore-scripts` after the build. This is faster
than `pnpm prune --prod`, which is interactive on workspace projects
(prompts "Proceed? (Y/n)" to stdin) and deadlocks under the
non-interactive build environment. See
[nodejs/corepack#612](https://github.com/nodejs/corepack/issues/612)
for the corepack-keyring refresh in step 2.

### Why the daemon shares the snap name

`apps.etherpad` matches the snap name `etherpad`, so users invoke the
daemon via `snap install etherpad` → bare `etherpad` command. The CLI
passthrough is exposed as `etherpad.cli` (e.g.
`etherpad.cli importSqlFile something.sql`).

## Testing

Three layers, each independently runnable:

### 1. Wrapper unit tests (~5 s, no snapd/sudo)

```
bash snap/tests/run-all.sh
```

Runs `bash -n` syntax checks on every wrapper + hook, then sources
each `test-*.sh` and reports pass/fail counts. Coverage:

- `test-snapcraft-yaml.sh` — required keys, name validity, daemon-app
  matches snap name, no `etherpad-lite` regression, environment vars
  whitelist.
- `test-cli.sh` — path-traversal rejection (`../`, subdir, empty),
  `.ts` / `.sh` dispatch, default-case rejection, no-args usage.
- `test-configure.sh` — port (1–65535 integer) and ip (v4/v6) validation
  via mocked `snapctl`.
- `test-service-bootstrap.sh` — first-run seeding from
  `settings.json.template`, sed rewrite of dbType/filename/ip/port,
  writable-dir creation, snapctl override propagation to node env,
  idempotency on second run, default fallbacks.

All tests use **port 9003** for any binding (per project convention,
since 9001 is reserved for ad-hoc local Etherpad work).

### 2. CI build verification

`.github/workflows/snap-build.yml` runs on every PR that touches
`snap/`, `settings.json.template`, or the workflow itself. Two jobs:

- `wrapper-tests` — runs `snap/tests/run-all.sh` (~5 s).
- `snap-pack` — runs `snapcraft pack --destructive-mode` and uploads
  the resulting `.snap` as an artifact (downloadable from the run
  summary so reviewers can sideload).

This is intentionally separate from `snap-publish.yml` (tag-triggered,
LXD-based, pushes to the store).

### 3. End-to-end smoke test (~3 min, requires sudo + snapd)

```
bash snap/tests/smoke.sh
```

Rebuilds via destructive-mode, installs the resulting `.snap`,
configures `port=9003`, restarts, waits for plugin migration to
finish, asserts a listener on 9003, hits `/health`, and tails the
last 20 log lines. Useful when changing the wrappers or the build
recipe before pushing.

## Development workflow

```
# 1. Make a change to snap/snapcraft.yaml or one of the wrappers.

# 2. Fast feedback loop — only the unit tests:
bash snap/tests/run-all.sh

# 3. Full local verification — actually build and install:
bash snap/tests/smoke.sh

# 4. Push. CI will run wrapper-tests + snap-pack on the PR.
git push
```

If `snapcraft pack` complains about the LXD provider,
`--destructive-mode` lets you build directly on the host (used by both
the smoke script and CI). It pollutes the host with build deps and
puts `parts/`, `stage/`, `prime/` in the worktree (gitignored). Wipe
with `sudo rm -rf parts stage prime`.

## Publishing

Maintainers only. See:
- [Register a snap](https://documentation.ubuntu.com/snapcraft/latest/how-to/publishing/register-a-snap/) — claims the name on the store
- [`snapcraft export-login`](https://documentation.ubuntu.com/snapcraft/reference/commands/export-login/) — generates the credential we put in `SNAPCRAFT_STORE_CREDENTIALS`
- [Snapcraft publishing how-to index](https://documentation.ubuntu.com/snapcraft/latest/how-to/publishing/)

One-time setup:

```
snapcraft register etherpad
snapcraft export-login --snaps etherpad \
  --channels edge,stable \
  --acls package_access,package_push,package_release -
```

Store the printed credential in the repo secret
`SNAPCRAFT_STORE_CREDENTIALS`. Create a GitHub Environment named
`snap-store-stable` with required reviewers so stable promotion is
gated.

`.github/workflows/snap-publish.yml` then handles the rest on every
`vX.Y.Z` (or `X.Y.Z`) tag: build → publish to `edge` → manual approval
gate → publish to `stable`.

## Troubleshooting

**Daemon flapping with `EROFS: read-only file system`** — Etherpad is
trying to write somewhere inside `$SNAP`. Check whether the path is
covered by the `var/` symlink (architecture section above). New write
targets need either an additional symlink at build time
(`snap/snapcraft.yaml` step 4) or a config knob to redirect into
`$SNAP_COMMON`.

**`Cannot find package 'tsx'`** — the wrapper must `cd "${APP_DIR}/src"`
before `node`, since `tsx` lives in the workspace's `node_modules` and
not at the install root under pnpm hoisting.

**`ERR_REQUIRE_CYCLE_MODULE`** — use bare `--import tsx`, not
`--import tsx/esm`. The ESM-only loader trips on Etherpad's mixed
CJS/ESM source.

**`snap install` fails with `unable to contact snap store`** — almost
always a Canonical-side outage. Check
[snapcraft.statuspage.io](https://snapcraft.statuspage.io). For
*local* development you can sidestep the store dependency entirely by
building with `snapcraft pack --destructive-mode` (no LXD container
provisioning, so no in-container `snap install`).

**`pnpm prune --prod` hangs forever** — never use it directly here. It
has an interactive "Proceed? (Y/n)" prompt for workspaces that
deadlocks under sudo/tee. The build recipe uses
`rm -rf node_modules && pnpm install --prod --frozen-lockfile
--ignore-scripts` instead.

**`snap refresh` blew away my data** — it didn't. Pad data is in
`/var/snap/etherpad/common/`, which is preserved across refreshes.
Check `/var/snap/etherpad/common/var/etherpad.db` exists.
