# Privacy

This document describes what Etherpad stores and logs about its users, so
operators can publish an accurate data-processing statement.

## Pad content and author identity

- Pad text, revision history, and chat messages are written to the
  configured database (see `dbType` / `dbSettings`).
- Authorship is tracked by an opaque `authorID` that is bound to a
  short-lived author-token cookie. There is no link between an authorID
  and a real-world identity unless a plugin or SSO layer adds one.

## IP addresses

Etherpad never writes a client IP to its database. IPs only appear in
`log4js` output (the `access`, `http`, `message`, and console loggers).
Whether those are persisted depends entirely on the log appender your
deployment configures.

The `ipLogging` setting (`settings.json`) controls what those log
records contain. All five log sites respect it:

| Setting value | Access / auth / rate-limit log contents |
| --- | --- |
| `"anonymous"` (default) | the literal string `ANONYMOUS` |
| `"truncated"` | IPv4 with last octet zeroed (`1.2.3.0`); IPv6 truncated to the first /48 (`2001:db8:1::`); IPv4-mapped IPv6 truncates the embedded v4; unknowns fall back to `ANONYMOUS` |
| `"full"` | the original IP address |

The pre-2026 boolean `disableIPlogging` is still honoured for one
release cycle: `true` maps to `"anonymous"`, `false` maps to `"full"`.
A deprecation WARN is emitted when only the legacy setting is present.

## Rate limiting

The in-memory socket rate limiter keys on the raw client IP for the
duration of the limiter window (see `commitRateLimiting` in
`settings.json`). This state is never written to disk, never sent to a
plugin, and is thrown away on server restart.

## What Etherpad does not do

- No IP addresses are written to the database.
- No IP addresses are sent to `clientVars` (and therefore to the
  browser). The long-standing `clientIp: '127.0.0.1'` placeholder was
  removed in the same change that introduced `ipLogging`.
- No IP addresses are passed to server-side plugin hooks by Etherpad
  itself. Plugins that receive a raw `req` can still read `req.ip`
  directly — audit your installed plugins if you need to rule that
  out.

## Cookies

See [`cookies.md`](cookies.md) for the full cookie list.

## Right to erasure

See
[`docs/superpowers/specs/2026-04-18-gdpr-pr1-deletion-controls-design.md`](https://github.com/ether/etherpad/blob/develop/docs/superpowers/specs/2026-04-18-gdpr-pr1-deletion-controls-design.md)
for the deletion-token mechanism. Full author erasure is tracked as a
follow-up in [ether/etherpad#6701](https://github.com/ether/etherpad/issues/6701).

## Privacy banner (optional)

The `privacyBanner` block in `settings.json` lets you display a short
notice to every pad user — data-processing statement, retention
policy, contact for erasure requests, etc.

```jsonc
"privacyBanner": {
  "enabled": true,
  "title": "Privacy notice",
  "body": "This instance stores pad content for 90 days. Contact privacy@example.com to request erasure.",
  "learnMoreUrl": "https://example.com/privacy",
  "dismissal": "dismissible"
}
```

The banner is rendered from plain text (HTML is escaped) with one
paragraph per line. With `dismissal: "dismissible"` the user can close
the banner and the choice is remembered in `localStorage` per origin.
`dismissal: "sticky"` removes the close button so the notice is shown
on every pad load.
