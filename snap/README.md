# Etherpad snap

Packages Etherpad as a [Snap](https://snapcraft.io/) for publishing to the
Snap Store.

## Build locally

```
sudo snap install --classic snapcraft
sudo snap install lxd && sudo lxd init --auto
snapcraft            # from repo root; uses LXD by default
```

Output: `etherpad_<version>_<arch>.snap`.

## Install the local build

```
sudo snap install --dangerous ./etherpad_*.snap
sudo snap start etherpad
curl http://127.0.0.1:9001/health
```

Logs: `sudo snap logs etherpad -f`.

## Configure

The snap seeds `$SNAP_COMMON/etc/settings.json` from the upstream
template on first run. Edit that file to customise Etherpad, then:

```
sudo snap restart etherpad
```

A few values are exposed as snap config for convenience:

| Key                            | Default   | Notes           |
| ------------------------------ | --------- | --------------- |
| `snap set etherpad port=9001`  | `9001`    | Listen port     |
| `snap set etherpad ip=0.0.0.0` | `0.0.0.0` | Bind address    |

Pad data (sqlite DB at `var/etherpad.db`, logs) lives in
`/var/snap/etherpad/common/` and survives `snap refresh`. The
shipped `settings.json.template` defaults to `dbType: "dirty"`, which
the template itself warns is dev-only; the launch wrapper rewrites the
seeded copy to `sqlite` on first run so users get an ACID-safe DB out
of the box.

## Publish to the Snap Store

Maintainers only. See
[Releasing to the Snap Store](https://snapcraft.io/docs/releasing-to-the-snap-store).

One-time setup:

```
snapcraft register etherpad
snapcraft export-login --snaps etherpad \
  --channels edge,stable \
  --acls package_access,package_push,package_release -
```

Store the printed credential in the repo secret
`SNAPCRAFT_STORE_CREDENTIALS`. CI (`.github/workflows/snap-publish.yml`)
handles the rest on every `v*` tag.
