# Home Assistant Add-on: Etherpad

Realtime collaborative document editor, wrapped as a one-click Home
Assistant add-on.

## Installation

> [!NOTE]
> This add-on currently lives in-tree at `packaging/home-assistant/` of
> the main Etherpad repository. Home Assistant's Add-on Store expects
> `repository.yaml` at the **root** of a repo, so the main Etherpad repo
> URL is not directly installable until the add-on is split out into its
> own repo (e.g. `ether/home-assistant-addon-etherpad`) or submitted to
> the community umbrella [`hassio-addons/repository`](https://github.com/hassio-addons/repository).
> Track the publication plan in the PR that introduced this scaffold.

Once published, installation will be:

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Click the three-dot menu (top right) → **Repositories**.
3. Add the dedicated add-on repository URL.
4. Find **Etherpad** in the store, click **Install**, then **Start**.
5. Use **Open Web UI** to launch Etherpad through HA ingress, or browse
   directly to `http://<ha-host>:9001`.

## Configuration

| Option                  | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `title`                 | Instance name shown in the browser tab.                               |
| `require_authentication`| If `true`, all pads require login.                                    |
| `admin_password`        | Password for the built-in `admin` user (access to `/admin`).          |
| `user_password`         | Password for the built-in `user` account.                             |
| `default_pad_text`      | Text inserted into every newly-created pad.                           |
| `db_type`               | One of `dirty` (default, file-backed), `mysql`, `postgres`, `sqlite`. |
| `db_host`/`db_port`/... | Used only when `db_type` is not `dirty`.                              |
| `trust_proxy`           | Leave `true` so Home Assistant ingress works correctly.               |
| `log_level`             | Etherpad log verbosity.                                               |

### Data persistence

When `db_type` is `dirty` (the default), pads are stored in
`/data/dirty.db` inside the add-on's persistent volume. Other DB types
expect an external database you operate yourself.

### Ingress

This add-on is ingress-enabled: Home Assistant proxies requests to
Etherpad behind authentication, and Etherpad's `trustProxy` setting
ensures cookies and client IPs work correctly. Keep `trust_proxy` set to
`true` for ingress to function.

If ingress misbehaves (Etherpad does not currently support a configurable
URL base path), disable it by editing `config.yaml` and use the direct
port 9001 instead.

## Security notes

- **Admin passwords are stored in plaintext** in Home Assistant's
  supervisor database (the `options.json` that the add-on reads). For
  stronger secret handling, install the `ep_hash_auth` Etherpad plugin
  and supply a bcrypt hash via a hand-edited `settings.json` (advanced).
- The direct port (9001) bypasses Home Assistant authentication.
  Firewall it off, or leave only ingress enabled if you care.

## Links

- Etherpad: <https://etherpad.org>
- Upstream repo: <https://github.com/ether/etherpad-lite>
- Docker image: <https://hub.docker.com/r/etherpad/etherpad>
- Report bugs: <https://github.com/ether/etherpad-lite/issues>
- HA add-on docs: <https://developers.home-assistant.io/docs/add-ons/>

## Icon and logo

This scaffold ships without `icon.png` / `logo.png`. Add before
publishing:

- `icon.png` — 128×128 square, shown in the add-on list.
- `logo.png` — 250×100 wide, shown on the add-on detail page.

Source: see Etherpad brand assets at
<https://github.com/ether/etherpad-lite>.
