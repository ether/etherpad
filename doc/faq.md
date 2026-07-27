# FAQ

This page answers common operational questions about running and maintaining
an Etherpad instance. It collects material previously kept on the project wiki.

## How do I install Etherpad?

There are several supported ways to install Etherpad. Pick whichever suits your
environment.

### Docker

The official image is published to Docker Hub (`etherpad/etherpad`) and to the
GitHub Container Registry (`ghcr.io/ether/etherpad`) with identical tags.

```bash
docker pull etherpad/etherpad
docker run -p 9001:9001 etherpad/etherpad
```

See the [Docker chapter](./docker.md) for building personalized images, enabling plugins, and
configuring office-format import/export.

### One-line installer (macOS / Linux / WSL)

```bash
curl -fsSL https://raw.githubusercontent.com/ether/etherpad/master/bin/installer.sh | sh
```

On Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/ether/etherpad/master/bin/installer.ps1 | iex
```

The installer clones Etherpad, installs dependencies and builds the frontend.
Set `ETHERPAD_RUN=1` to also start it once the install finishes.

### apt repository (Debian / Ubuntu)

Etherpad publishes a signed APT repository (`stable` channel). Import the signing
key, add the repository and install:

```bash
curl -fsSL https://etherpad.org/key.asc \
  | sudo gpg --dearmor -o /usr/share/keyrings/etherpad.gpg

echo "deb [signed-by=/usr/share/keyrings/etherpad.gpg] https://etherpad.org/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/etherpad.list

sudo apt-get update
sudo apt-get install etherpad
```

The repository provides `amd64` and `arm64` builds. Etherpad depends on
Node.js >= 24, so on older distributions you may also need NodeSource's apt
repository to satisfy that dependency.

### From source

Etherpad requires [Node.js](https://nodejs.org/) >= 24 and `pnpm`.

```bash
git clone -b master https://github.com/ether/etherpad
cd etherpad
pnpm i
pnpm run build:etherpad
pnpm run prod
```

Then open `http://localhost:9001`.

## What URL paths does Etherpad serve?

| Path | Description |
|------|-------------|
| `/admin` | Administration dashboard (requires admin login). |
| `/admin/plugins` | Install, update and remove plugins from the web UI. |
| `/admin/settings` | Edit `settings.json` from the web UI. |
| `/p/:padID` | Open (or create) the pad with the given `padID`, e.g. `/p/foo`. |
| `/p/:padID/timeslider` | Open the pad's history/timeslider view. Append `#N` to jump to a specific revision, e.g. `/p/foo/timeslider#5`. |
| `/p/:padID/export/:type` | Export the pad in the given format, e.g. `/p/foo/export/html`. Append `?revs=N` to export a specific revision. |

Supported export types:

- **Native (no extra dependencies):** `txt`, `html`, `etherpad`, `docx`, `pdf`.
- **Via LibreOffice:** `odt`, `doc`, `rtf` — these require the `soffice` setting
to point at a LibreOffice executable. See the office-format notes in the
[Docker chapter](./docker.md).

## How do I list all pads?

The recommended way is the HTTP API method `listAllPads`, combined with `jq`:

```bash
ETHERPAD_HOST='https://pad.example.com'
ETHERPAD_API_KEY='...'      # the APIKEY.txt file in the Etherpad root
ETHERPAD_API_VERSION='...'  # see https://pad.example.com/api

curl -s "${ETHERPAD_HOST}/api/${ETHERPAD_API_VERSION}/listAllPads?apikey=${ETHERPAD_API_KEY}" \
  | jq -r '.data.padIDs[]'
```

For an interactive list with management actions, install the `ep_adminpads2`
plugin and browse to `/admin/pads`.

As a last resort you can query the database directly. The exact query depends on
your configured backend; pad records use keys of the form `pad:<padID>` and
`pad:<padID>:revs:<n>`. For example, with SQLite:

```bash
sqlite3 ./var/sqlite.db "select key from store where key like 'pad:%'" \
  | grep -Eo '^pad:[^:]+' \
  | sed -e 's/pad://' \
  | sort -u
```

Prefer the API or admin plugin over direct SQL: the schema is an implementation
detail and may change.

## How do I delete or manage pads?

Use the HTTP API `deletePad` method:

```bash
curl -s "${ETHERPAD_HOST}/api/${ETHERPAD_API_VERSION}/deletePad?apikey=${ETHERPAD_API_KEY}&padID=foo"
```

The API also offers `copyPad`, `movePad`, `getRevisionsCount` and more — see the
[HTTP API chapter](./api/http_api.md).

For a web UI, install the `ep_adminpads2` plugin and manage pads from
`/admin/pads`, where you can search, view and delete pads.

The `deletePad` CLI tool is also available for operators:

```bash
pnpm run --filter bin deletePad <padID>
```

## How do I back up and restore pads?

### Back up the whole instance

All pad data lives in the configured database. Back it up using the tool
appropriate to your backend (for example `mysqldump` for MySQL/MariaDB,
`pg_dump` for PostgreSQL, or a file copy of `var/*.db` for the file-based
`dirty`/`rusty` engines while Etherpad is stopped). A regular, automated dump of
the database is the canonical backup for a production instance.

### Back up a single pad

Export the pad over HTTP by appending `/export/<type>` to its URL. Plain text,
HTML and the round-trippable `etherpad` format are most useful for backups:

```bash
curl -o mypad.txt   https://pad.example.com/p/foo/export/txt
curl -o mypad.html  https://pad.example.com/p/foo/export/html
curl -o mypad.etherpad https://pad.example.com/p/foo/export/etherpad
```

The `etherpad` export preserves the pad's full history and can be re-imported,
making it the best choice for migrating or archiving an individual pad.

### Restore or inspect an old revision

Every state the pad has been in is stored in the database, so you can retrieve
an earlier revision without a separate backup:

- Open `/p/:padID/timeslider` to browse the history and find the revision
number you want.
- Export a specific revision directly with the `?revs=N` query parameter, e.g.
`https://pad.example.com/p/foo/export/html?revs=1000`.

### Repairing a damaged pad

If a pad is corrupt, use the CLI repair tools (`checkPad`, `repairPad`,
`rebuildPad`) documented in the [CLI chapter](./cli.md). Always back up the database before
running write operations.

## How do I limit history or prune revisions?

Etherpad keeps the full revision history of every pad, so the database grows
over time. To reclaim space, use the pad-compaction CLI tools, which collapse or
trim revision history for one pad, every pad, or only stale pads:

```bash
# Collapse all history of one pad
pnpm run --filter bin compactPad <padID>

# Keep only the last 50 revisions of one pad
pnpm run --filter bin compactPad <padID> --keep 50

# Compact every pad on the instance
pnpm run --filter bin compactAllPads

# Compact only pads not edited in the last 90 days, keeping the last 50 revisions
pnpm run --filter bin compactStalePads --older-than 90 --keep 50
```

These tools require `cleanup.enabled = true` in `settings.json` and are
**destructive** — history is collapsed or trimmed. Export anything you can't
afford to lose via the pad's `/export/etherpad` route first. The same primitive
is available over the wire as the `compactPad` HTTP API method. See the [CLI chapter](./cli.md) for full details.
