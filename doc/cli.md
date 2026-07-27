# CLI

Etherpad ships a set of operator tools in the `bin/` directory for migrating
data, reclaiming database space, repairing damaged pads, managing sessions and
managing plugins. They are TypeScript scripts run through `tsx`, and each one
is registered as a pnpm script in `bin/package.json`. Invoke them from the
Etherpad root with:

```
pnpm run --filter bin <script> [args]
```

For example `pnpm run --filter bin checkPad my-pad`. Running the `.ts` files
directly with `node bin/foo.js` will **not** work — there are no compiled `.js`
files and the scripts need the `tsx` loader.

## Running vs. stopped

Some tools talk to a **running** Etherpad over its HTTP API (they read the API
key from `APIKEY.txt` and connect to `ip`/`port` from `settings.json`). Others
open the database **directly** and must be run while Etherpad is **stopped**,
otherwise you risk a database lock or a corrupt write. Each tool below is
labelled accordingly.

## Database migration (`migrateDB`)

`migrateDB` copies every record from one database to another. It takes two
settings files — `--file1` is the **source**, `--file2` is the **target** —
each describing a database with a `dbType` and `dbSettings`. Both paths are
resolved relative to the Etherpad root.

In this example we migrate from the old `dirty` db to the new `rustydb` engine.
Create a source descriptor `source.json` in the Etherpad root:

````json
{
  "dbType": "dirty",
  "dbSettings": {
    "filename": "./var/dirty.db"
  }
}
````

and a target descriptor `target.json`:

````json
{
  "dbType": "rustydb",
  "dbSettings": {
    "filename": "./var/rusty.db"
  }
}
````

Then run:

```
pnpm run --filter bin migrateDB --file1 source.json --file2 target.json
```

After some time the data is copied over to the new database. Run this with
Etherpad **stopped**.

## Pad compaction

Long-lived pads with heavy edit history accumulate revisions in the database.
Three CLIs reclaim that space, in increasing scope. All of them drive a
**running** Etherpad over the `compactPad` HTTP API.

| Tool | Targets | When to use |
| --- | --- | --- |
| `pnpm run --filter bin compactPad <padID>` | one pad | you know which pad is fat |
| `pnpm run --filter bin compactAllPads` | every pad | bulk reclaim across the whole instance |
| `pnpm run --filter bin compactStalePads --older-than N` | pads not edited in N days | reclaim the cold tail without touching pads still in active use |

All three are gated on `cleanup.enabled = true` in `settings.json` and are
**destructive**: history is collapsed (or trimmed). Export anything you can't
afford to lose with the `getEtherpad` API first.

Common flags:

- `--keep N` — retain the last N revisions instead of collapsing all history.
- `--dry-run` — list pads and revision counts without writing (`compactAllPads`
  and `compactStalePads` only).
- `--older-than N` — (`compactStalePads` only, **required**) only consider pads
  not edited in the last N days.

### Examples

````
# Compact a specific pad, collapsing all history.
pnpm run --filter bin compactPad my-pad

# Keep only the last 50 revisions of one pad.
pnpm run --filter bin compactPad my-pad --keep 50

# Compact every pad on the instance (per-pad failures don't stop the run).
pnpm run --filter bin compactAllPads
pnpm run --filter bin compactAllPads --dry-run

# Compact only pads not edited in the last 90 days, keeping the last 50 revisions.
pnpm run --filter bin compactStalePads --older-than 90 --keep 50
pnpm run --filter bin compactStalePads --older-than 90 --dry-run
````

`compactStalePads` is the right tool for periodic operator runs on long-lived
instances — hot pads that users are still navigating in timeslider stay
untouched (staleness is even re-checked right before each compaction), and only
the cold tail is rewritten. Per-pad failures (including a `getLastEdited` fault)
are counted but do not abort the bulk run; the exit code reflects whether
anything failed.

See the `compactPad` HTTP API in `doc/api/http_api.md` for the same primitive
over the wire (issues #6194, #7642).

## Pad maintenance and debugging

| Tool | Purpose | Args | Etherpad |
| --- | --- | --- | --- |
| `pnpm run --filter bin checkPad <padID>` | Check one pad's revisions for data corruption. | `<padID>` | stopped |
| `pnpm run --filter bin checkAllPads` | Check every pad on the instance for data corruption. | none | stopped |
| `pnpm run --filter bin repairPad <padID>` | Repair a pad by extracting all of its data, deleting it and re-inserting it. | `<padID>` | stopped (the script refuses to be useful otherwise) |
| `pnpm run --filter bin rebuildPad <padID> <rev> [newPadID]` | Rebuild a damaged pad into a new pad at a known-good revision. The new pad defaults to `<padID>-rebuilt` and must not already exist. | `<padID> <rev> [newPadID]` | stopped |
| `node --import tsx extractPadData.ts <padID>` | Export one pad's data to a `<padID>.db` dirtyDB file so a bug can be reproduced in a dev environment. (No pnpm alias — run with the `tsx` loader directly from `bin/`.) | `<padID>` | stopped |

`checkPad`/`checkAllPads` report corruption but do not modify anything;
`repairPad` and `rebuildPad` write. As always, back up first.

## Database tools

| Tool | Purpose | Args | Etherpad |
| --- | --- | --- | --- |
| `pnpm run --filter bin migrateDB --file1 <src.json> --file2 <dst.json>` | Copy all records from a source database to a target database (see above). | `--file1 <src.json> --file2 <dst.json>` | stopped |
| `pnpm run --filter bin migrateDirtyDBtoRealDB` | One-shot migration of `var/dirty.db` into the real database configured in `settings.json`. Back up `dirty.db` first; may need more memory (e.g. `node --max-old-space-size=4096`). | none (reads target db from `settings.json`) | stopped |
| `pnpm run --filter bin importSqlFile <sqlFile>` | Import a SQL dump (rows of `REPLACE INTO store VALUES (...)`) into the configured database. | `<sqlFile>` | stopped |

## Session and pad management

| Tool | Purpose | Args | Etherpad |
| --- | --- | --- | --- |
| `pnpm run --filter bin deletePad <padID>` | Delete a single pad. | `<padID>` | running |
| `pnpm run --filter bin deleteAllGroupSessions` | Delete all group sessions (useful when a misconfiguration has wedged group access). | none | running |
| `pnpm run --filter bin createUserSession` | Create a throwaway group, pad, author and session, printing a `sessionID` you can set as a cookie — handy for debugging session-based configs. | none | running |

## Plugin tools

| Tool | Purpose | Args | Etherpad |
| --- | --- | --- | --- |
| `pnpm run --filter bin plugins <action> [names…]` | Manage installed plugins. Actions: `i`/`install`, `rm`/`remove`, `ls`/`list`, `up`/`update`. Install also accepts `--path <dir>` and `--github <repo>` sources. | `<action> [names…]` | stopped |
| `pnpm run --filter bin checkPlugin <ep_name> [autofix\|autocommit\|autopush]` | Lint a plugin checkout (a sibling `../ep_name` directory) against the plugin conventions; optional modes auto-fix, commit, or commit+push+publish (the last is dangerous). | `<ep_name> [mode]` | n/a |
| `pnpm run --filter bin stalePlugins` | List plugins in the registry not updated in over two years, with maintainer email. Requires `privacy.pluginCatalog` enabled. | none | n/a |
