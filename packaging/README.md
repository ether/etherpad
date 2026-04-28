# Etherpad Debian / RPM packaging

Produces native `.deb` (and, with the same manifest, `.rpm` / `.apk`)
packages for Etherpad using [nfpm](https://nfpm.goreleaser.com).

## Layout

```
packaging/
  nfpm.yaml                # nfpm package manifest
  bin/etherpad             # /usr/bin launcher
  scripts/                 # preinst / postinst / prerm / postrm
  systemd/etherpad.service
  systemd/etherpad.default
  etc/settings.json.dist   # populated in CI from settings.json.template
```

Built artefacts land in `./dist/`.

## Building locally

Prereqs: Node 24 (current LTS; `engines.node` floor is 20), pnpm 10+, nfpm.

```sh
pnpm install --frozen-lockfile
pnpm run build:etherpad

# Stage the tree the way CI does:
STAGE=staging/opt/etherpad
mkdir -p "$STAGE"
cp -a src bin package.json pnpm-workspace.yaml README.md LICENSE \
      node_modules "$STAGE/"
printf 'packages:\n  - src\n  - bin\n' > "$STAGE/pnpm-workspace.yaml"
cp settings.json.template packaging/etc/settings.json.dist

VERSION=$(node -p "require('./package.json').version") \
ARCH=amd64 \
    nfpm package --packager deb -f packaging/nfpm.yaml --target dist/
```

## End-to-end test (Docker, no real systemd needed)

`packaging/test-local.sh` builds the `.deb` and runs the same smoke
test the CI workflow does, inside a throwaway systemd-enabled
container:

```sh
packaging/test-local.sh                # build + smoke + purge
packaging/test-local.sh --shell        # leave the container up so you can poke around
packaging/test-local.sh --build-only   # just produce dist/*.deb
```

This is the fastest way to validate that the systemd hardening, plugin
path symlinks, and tsx wrapper actually work together before pushing.

## Installing

The release page publishes both versioned and stable filenames per arch:

```sh
# Stable URL — always points at the most recent release:
curl -fsSL -o etherpad-latest_amd64.deb \
  https://github.com/ether/etherpad/releases/latest/download/etherpad-latest_amd64.deb
sudo apt install ./etherpad-latest_amd64.deb

# Or pin to a specific version:
sudo apt install ./dist/etherpad_<version>_amd64.deb

sudo systemctl start etherpad
curl http://localhost:9001/health
```

`apt` will pull in `nodejs (>= 22)` (matches Etherpad's `engines.node`).
Recommended runtime is the current Node.js LTS (24); on distros without a
new enough Node, add NodeSource first:

```sh
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
```

## Configuration

- Edit `/etc/etherpad/settings.json`, then
  `sudo systemctl restart etherpad`.
- Environment overrides: `/etc/default/etherpad`.
- Logs: `journalctl -u etherpad -f`.
- Data (sqlite default): `/var/lib/etherpad/etherpad.db`.

The shipped settings template defaults to `dbType: "dirty"`, which the
template itself warns is for testing only. `postinstall` rewrites the
seeded `/etc/etherpad/settings.json` to `sqlite` and points it at
`/var/lib/etherpad/etherpad.db` so fresh installs get an ACID-safe DB
out of the box. Existing `/etc/etherpad/settings.json` is never touched
on upgrade.

## Upgrading

`dpkg --install etherpad_<new>.deb` (or `apt install`) replaces the app
tree under `/opt/etherpad` while preserving `/etc/etherpad/*` and
`/var/lib/etherpad/*`. The service is restarted automatically.

## Removing

- `sudo apt remove etherpad` — keeps config and data.
- `sudo apt purge etherpad` — also removes config, data, and the
  `etherpad` system user.

## Publishing to an APT repository (follow-up)

Out of scope here — requires credentials and ownership decisions.
Recipes once a repo is picked:

- **Cloudsmith** (easiest, free OSS tier):
  `cloudsmith push deb ether/etherpad/any-distro/any-version dist/*.deb`
- **Launchpad PPA**: requires signed source packages (a `debian/` tree),
  which nfpm does not produce — use `debuild` separately.
- **Self-hosted reprepro**:
  `reprepro -b /srv/apt includedeb stable dist/*.deb`

Wire the chosen option into `.github/workflows/deb-package.yml` after
the `release` job.
