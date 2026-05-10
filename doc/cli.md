# CLI

You can find different tools for migrating things, checking your Etherpad health in the bin directory.
One of these is the migrateDB command. It takes two settings.json files and copies data from one source to another one.
In this example we migrate from the old dirty db to the new rustydb engine. So we copy these files to the root of the etherpad-directory.

````json
{
  "dbType": "dirty",
  "dbSettings": {
    "filename": "./var/rusty.db"
  }
}
````



````json
{
  "dbType": "rustydb",
  "dbSettings": {
    "filename": "./var/rusty2.db"
  }
}
````


After that we need to move the data from dirty to rustydb.
Therefore, we call `pnpm run --filter bin migrateDB --file1 test1.json --file2 test2.json` with these two files in our root directories. After some time the data should be copied over to the new database.

## Pad compaction

Long-lived pads with heavy edit history accumulate revisions in the database. Three CLIs reclaim that space, in increasing scope:

| Tool | Targets | When to use |
| --- | --- | --- |
| `bin/compactPad.js <padID>` | one pad | you know which pad is fat |
| `bin/compactAllPads.js` | every pad | bulk reclaim across the whole instance |
| `bin/compactStalePads.js --older-than N` | pads not edited in N days | reclaim the cold tail without touching pads still in active use |

All three are gated on `cleanup.enabled = true` in `settings.json` and are **destructive**: history is collapsed (or trimmed). Export anything you can't afford to lose with `getEtherpad` first.

Common flags:

- `--keep N` — retain the last N revisions instead of collapsing all history.
- `--dry-run` — list pads and revision counts without writing.

### Examples

````
# Compact a specific pad, collapsing all history.
node bin/compactPad.js my-pad

# Keep only the last 50 revisions of one pad.
node bin/compactPad.js my-pad --keep 50

# Compact every pad on the instance (per-pad failures don't stop the run).
node bin/compactAllPads.js
node bin/compactAllPads.js --dry-run

# Compact only pads not edited in the last 90 days, keeping the last 50 revisions.
node bin/compactStalePads.js --older-than 90 --keep 50
node bin/compactStalePads.js --older-than 90 --dry-run
````

`bin/compactStalePads.js` is the right tool for periodic operator runs on long-lived instances — hot pads that users are still navigating in timeslider stay untouched, and only the cold tail is rewritten. Per-pad failures (including a `getLastEdited` fault) are counted but do not abort the bulk run; the exit code reflects whether anything failed.

See the `compactPad` HTTP API in `doc/api/http_api.md` for the same primitive over the wire (issues #6194, #7642).
