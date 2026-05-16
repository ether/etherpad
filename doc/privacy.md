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

## Right to erasure (GDPR Art. 17)

Etherpad anonymises an author rather than deleting their changesets
(deletion would corrupt every pad they contributed to). Operators
trigger erasure via the admin REST API:

```bash
curl -X POST \
  -H "Authorization: Bearer <admin JWT / apikey>" \
  "https://<instance>/api/1.3.1/anonymizeAuthor?authorID=a.XXXXXXXXXXXXXX"
```

The endpoint is gated by the `gdprAuthorErasure` setting (see
`settings.json`). It is **disabled by default**; set
`"gdprAuthorErasure": { "enabled": true }` to expose it. While
disabled, calls return HTTP 404 / API code 4 ("no such function").

What the call does:

- Zeros `name` and `colorId` on the `globalAuthor:<authorID>` record
  (kept as an opaque stub so changeset references still resolve to
  "an author" with no details).
- Deletes every `token2author:<token>` and `mapper2author:<mapper>`
  binding that pointed at this author. Once removed, a new session
  with the same token starts a fresh anonymous identity.
- Nulls `authorId` on chat messages the author posted; message text
  and timestamps are unchanged.

What it does not do:

- Delete pad content, revisions, or the attribute pool. If a pad
  itself should also be erased, use the pad-deletion token flow
  (PR1, `deletePad`).
- Touch other authors' edits.

The call is idempotent: calling it twice on the same authorID
short-circuits the second time and returns zero counters. Pad-level
deletion is covered separately by the deletion-token mechanism in
[`docs/superpowers/specs/2026-04-18-gdpr-pr1-deletion-controls-design.md`](https://github.com/ether/etherpad/blob/develop/docs/superpowers/specs/2026-04-18-gdpr-pr1-deletion-controls-design.md);
the rest of the GDPR work is tracked in
[ether/etherpad#6701](https://github.com/ether/etherpad/issues/6701).

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

The banner is rendered as a persistent gritter notification at the
bottom of the page (it inherits the same look as every other gritter
on the pad — no custom skin needed). The body is plain text (HTML is
escaped); each line becomes its own paragraph.

`dismissal` controls how the close (×) is handled:

- `"dismissible"` (default) — when the user closes the gritter, the
  choice is persisted in `localStorage` per origin and the banner is
  not shown again on subsequent pad loads.
- `"sticky"` — closing the gritter only hides it for the current
  session; the next pad load shows it again. (The close control is
  not removed; for an operator-enforced non-closable notice, render
  the policy out-of-band — e.g., a skin override or a reverse-proxy
  ribbon.)

Unknown `dismissal` values are coerced to `"dismissible"` with a
`logger.warn` at settings load.
