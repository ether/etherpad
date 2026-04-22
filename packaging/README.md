# Etherpad Debian / RPM packaging

Produces native `.deb` (and, with the same manifest, `.rpm` / `.apk`)
packages for Etherpad using [nfpm](https://nfpm.goreleaser.com).

## Layout

```
packaging/
  nfpm.yaml                   # nfpm package manifest
  bin/etherpad-lite           # /usr/bin launcher
  scripts/                    # preinst / postinst / prerm / postrm
  systemd/etherpad-lite.service
  systemd/etherpad-lite.default
  etc/settings.json.dist      # populated in CI from settings.json.template
```

Built artefacts land in `./dist/`.

## Building locally

Prereqs: Node 22, pnpm 10+, nfpm.

```sh
pnpm install --frozen-lockfile
pnpm run build:etherpad

# Stage the tree the way CI does:
STAGE=staging/opt/etherpad-lite
mkdir -p "$STAGE"
cp -a src bin package.json pnpm-workspace.yaml README.md LICENSE \
      node_modules "$STAGE/"
printf 'packages:\n  - src\n  - bin\n' > "$STAGE/pnpm-workspace.yaml"
cp settings.json.template packaging/etc/settings.json.dist

VERSION=$(node -p "require('./package.json').version") \
ARCH=amd64 \
    nfpm package --packager deb -f packaging/nfpm.yaml --target dist/
```

## Installing

```sh
sudo apt install ./dist/etherpad-lite_2.6.1_amd64.deb
sudo systemctl start etherpad-lite
curl http://localhost:9001/health
```

`apt` will pull in `nodejs (>= 20)`; on Ubuntu 22.04 add NodeSource first:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```

## Configuration

- Edit `/etc/etherpad-lite/settings.json`, then
  `sudo systemctl restart etherpad-lite`.
- Environment overrides: `/etc/default/etherpad-lite`.
- Logs: `journalctl -u etherpad-lite -f`.
- Data (dirty-DB default): `/var/lib/etherpad-lite/`.

## Upgrading

`dpkg --install etherpad-lite_<new>.deb` (or `apt install`) replaces the
app tree under `/opt/etherpad-lite` while preserving
`/etc/etherpad-lite/*` and `/var/lib/etherpad-lite/*`. The service is
restarted automatically.

## Removing

- `sudo apt remove etherpad-lite` — keeps config and data.
- `sudo apt purge etherpad-lite` — also removes config, data, and the
  `etherpad` system user.

## Publishing to an APT repository (follow-up)

Out of scope here — requires credentials and ownership decisions.
Recipes once a repo is picked:

- **Cloudsmith** (easiest, free OSS tier):
  `cloudsmith push deb ether/etherpad-lite/any-distro/any-version dist/*.deb`
- **Launchpad PPA**: requires signed source packages (a `debian/` tree),
  which nfpm does not produce — use `debuild` separately.
- **Self-hosted reprepro**:
  `reprepro -b /srv/apt includedeb stable dist/*.deb`

Wire the chosen option into `.github/workflows/deb-package.yml` after
the `release` job.
