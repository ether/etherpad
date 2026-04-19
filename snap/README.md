# Etherpad snap

Packages Etherpad as a [Snap](https://snapcraft.io/) for publishing to the
Snap Store.

## Build locally

```
sudo snap install --classic snapcraft
sudo snap install lxd && sudo lxd init --auto
snapcraft            # from repo root; uses LXD by default
```

Output: `etherpad-lite_<version>_<arch>.snap`.

## Install the local build

```
sudo snap install --dangerous ./etherpad-lite_*.snap
sudo snap start etherpad-lite
curl http://127.0.0.1:9001/health
```

Logs: `sudo snap logs etherpad-lite -f`.

## Configure

The snap seeds `$SNAP_COMMON/etc/settings.json` from the upstream
template on first run. Edit that file to customise Etherpad, then:

```
sudo snap restart etherpad-lite
```

A few values are exposed as snap config for convenience:

| Key                                 | Default   | Notes           |
| ----------------------------------- | --------- | --------------- |
| `snap set etherpad-lite port=9001`  | `9001`    | Listen port     |
| `snap set etherpad-lite ip=0.0.0.0` | `0.0.0.0` | Bind address    |

Pad data (dirty DB, logs) lives in `/var/snap/etherpad-lite/common/` and
survives `snap refresh`.

## Publish to the Snap Store

Maintainers only. See
[Releasing to the Snap Store](https://snapcraft.io/docs/releasing-to-the-snap-store).

One-time setup:

```
snapcraft register etherpad-lite
snapcraft export-login --snaps etherpad-lite \
  --channels edge,stable \
  --acls package_access,package_push,package_release -
```

Store the printed credential in the repo secret
`SNAPCRAFT_STORE_CREDENTIALS`. CI (`.github/workflows/snap-publish.yml`)
handles the rest on every `v*` tag.
