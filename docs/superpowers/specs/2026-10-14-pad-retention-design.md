# Pad retention: delete pads after X days without edits

Date: 2026-10-14

## Goal

Let an operator say "delete any pad nobody has edited in N days" and have
Etherpad enforce it, with no cron job and no plugin.

This replaces the behaviour of `ep_delete_after_delay` (Framasoft, last
released 2025-09). That plugin imports internals that pnpm installs don't
expose, writes an HTML copy of every deleted pad to `deleted_pads/` (which
defeats the point of deleting), and recreates each pad as a tombstone so the
ID lives forever. None of its code is reused.

## Decisions

- **Core, not a plugin.** It sits next to `cleanup` and the GDPR settings.
  Plugins that reach into core internals rot, which is what happened here.
- **Hard delete.** `pad.remove()`, the same path as the `deletePad` API.
  No backup, no tombstone.
- **Warn near expiry only.** A notice shows when a pad opens within
  `warnBeforeDays` of expiry. No public TTL endpoint.
- **Every pad, with exclusions.** Group pads (`g.x$name`) are excluded by
  default because integrations (Nextcloud, Moodle, Mypads) keep their own
  references to them. `excludePattern` protects pads by ID.
- **In-process sweeper plus a check on open.** No CLI script.

## Settings

```jsonc
"padRetention": {
  "enabled": false,
  "dryRun": true,
  "deleteAfterDays": 365,
  "warnBeforeDays": 7,
  "sweepIntervalHours": 1,
  "excludeGroupPads": true,
  "excludePattern": null
}
```

- Off by default. Turning it on still only logs (`dryRun: true`) until the
  operator also sets `dryRun: false`.
- Days and hours may be fractional, so tests and small instances can use
  short windows.
- Invalid values (non-positive numbers, `warnBeforeDays` < 0, a regex that
  doesn't compile) log one error at startup and leave the feature off.
  Etherpad itself keeps running.

## Components

### `src/node/utils/PadRetention.ts`

- `checkPad(padId, now)` reads `pad:<id>` and the head revision's
  `meta.timestamp` straight from the database, so a sweep never loads pads
  into the pad cache. Returns:
  - `{action: 'skip', reason}` for excluded, missing or unreadable pads
  - `{action: 'keep', expiresAt}`
  - `{action: 'expire', lastEdited}`
- `expirePad(padId)` re-runs `checkPad` and deletes only if the pad is still
  expired. Concurrent calls for the same pad share one in-flight promise.
- `sweep()` walks `padManager.listAllPads()` one pad at a time, yielding to
  the event loop between pads. Each pad has its own `try/catch`, so one
  corrupt pad can't stop the sweep (see #7935). Logs one summary line.
- `checkOnOpen(padId)` is used by `CLIENT_READY`. It expires an overdue pad
  and returns what the client should be told.
- `start()` / `stop()` manage a chained `setTimeout` (the
  `SessionStore.startCleanup` pattern), unref'd. The first sweep runs 60s
  after start. `start()` is wired to `expressCreateServer` and stops any
  previous timer first, because that hook runs again on server restarts.
  `stop()` is wired to `shutdown`.

Never-edited pads aren't special. Revision 0's timestamp is the creation
time, so an abandoned new pad expires `deleteAfterDays` after creation.

A last-edit time in the future (clock skew) means keep.

### `PadMessageHandler.handleClientReady`

Before the pad is loaded, call `checkOnOpen(sessionInfo.padId)`. This is the
real pad ID, so read-only links are covered. Add the result to `clientVars`
as `padRetention`:

- `null`: feature off, dry run, pad excluded, or not near expiry
- `{state: 'expiring', msRemaining}`: inside the warning window
- `{state: 'expired', deleteAfterDays}`: the pad was just deleted, so the
  client is looking at a new pad with the default text.

Dry run sends `null`, because nothing is going to be deleted.

### Client (`src/static/js/pad_retention_notice.ts`)

Called from `pad.ts` after load. Shows one gritter (`class_name:
'pad-retention-notice'`) with html10n strings:

- expiring: sticky notice with time left, in days, or in hours if under a
  day
- expired: non-sticky notice that the old pad was deleted

New keys in `src/locales/en.json` under `pad.retention.*`.

## Deletion

`pad.remove()` already disconnects connected users, removes revisions, chat,
the read-only mapping, the group entry, author links and the deletion token,
and fires `padRemove` so plugins clean up their own data.

Readers who never edit don't count as activity. If a pad is deleted while
people are reading it, they're disconnected.

Several processes sharing one database each sweep. A pad that's already gone
is a skip, so no locking is needed.

## Logging

- Each deletion: `info` with pad ID, last-edit time and configured age.
- Dry run: `info` `would delete <id> (last edited <iso>)` per pad.
- Each sweep: one `info` summary: checked, deleted (or would delete),
  skipped, errors, duration.

## Testing

Backend (mocha, `src/tests/backend/specs/padRetention.ts`). Pads are aged by
rewriting the head revision's timestamp in the database.

- `checkPad`: expire, keep, never-edited new pad, group pad excluded and
  included, `excludePattern`, missing pad, future timestamp.
- `sweep`: deletes expired pads, keeps fresh ones, continues past a pad whose
  revision record is broken, dry run deletes nothing and logs each pad.
- Config validation: bad values leave the feature off and log an error.
- `CLIENT_READY`: an expired pad comes back as a new pad (rev 0) with
  `padRetention.state === 'expired'`; a pad inside the warning window gets
  `state: 'expiring'`; feature off gives `null`.

Frontend (Playwright): the expiring and expired notices render the
translated English text.

## Docs

- `settings.json.template`: commented `padRetention` block.
- `doc/privacy.md`: "Pad retention" section.
- `doc/faq.md`: link from the database-growth entry.

The CHANGELOG is written when a release is cut, so this PR doesn't add one.
