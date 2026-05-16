# PR3 — GDPR Anonymous Identity Hardening

Third of five GDPR PRs (ether/etherpad#6701). Today's anonymous author
token is generated and set by client JavaScript, which forces it to be a
non-`HttpOnly` cookie (any JS on the page — including XSS — can read it
and impersonate the author). This PR moves token issuance and the
authoritative cookie-set to the server so the cookie can be
`HttpOnly; Secure; SameSite=Lax` end-to-end, while staying
fully backwards-compatible for one release.

## Audit summary

- The author token is stored in the `ep_token` cookie (prefix `${cp}`)
  and generated client-side: `src/static/js/pad.ts:191-195` reads an
  existing cookie, otherwise calls `padutils.generateAuthorToken()` and
  writes a fresh cookie with `expires: 60` (days).
- Server-side mapping: `AuthorManager.getAuthor4Token()` (via
  `SecurityManager.checkAccess`) persists `token2author:<token>` → an
  `authorID`. The raw plaintext token is the DB key.
- Cookie attributes set in `pad_utils.ts:515-516` on the client's
  `Cookies` instance: `sameSite: 'Lax'` (or `'None'` in third-party
  iframes), `secure: <only on https>`. **`httpOnly` is not set** — JS
  (including XSS payloads) can read and replay the token.
- The CLIENT_READY socket message sends `token` in the payload;
  `SecurityManager.checkAccess` validates it via
  `padutils.isValidAuthorToken()` and resolves it to an authorID.
- No IP-based identity fallback exists today (confirmed while writing
  PR2 — `clientVars.clientIp` was hardcoded `'127.0.0.1'` and is
  removed in PR2).

The author-token cookie is a bearer credential that grants write access
(and, with PR1 shipped, bypasses the creator-cookie check for deletion)
to every pad this browser has ever touched. An `HttpOnly` cookie
eliminates the biggest class of token theft (XSS / third-party script
read).

## Goals

- Author-token cookies are set by the Etherpad server on the pad HTTP
  response, marked `HttpOnly; Secure (on HTTPS); SameSite=Lax` (or
  `None` in a third-party iframe context where the existing override
  applies).
- The client never reads or writes the author-token cookie. It also
  stops sending `token` in CLIENT_READY — the server reads the cookie
  from the socket.io handshake request instead.
- Existing sessions with a client-set token continue to work: the
  server honours a `token` field in CLIENT_READY when no `ep_token`
  cookie is present, migrates it to an HttpOnly cookie on the next
  HTTP response, and emits a one-time deprecation WARN.
- IP-based identity fallback stays off — document it so plugins can't
  accidentally re-introduce it.

## Non-goals

- Rotating or revoking tokens. Token lifecycle still "set once, valid
  until expiry". Revocation ties into author erasure (PR5).
- Changing the `token2author:<token>` DB key shape. Moving to hashed
  storage is worthwhile but orthogonal — slated for PR5 alongside
  author erasure.
- Moving the session / read-only cookies. Only the author token is in
  scope.
- Expanding deletion rights. PR1 already covered that surface.

## Design

### Server-side cookie set

- New middleware mounted on `/p/:pad` (and the admin-free static pad
  HTML responses): if the request carries no `ep_token` cookie (with
  the configured prefix), the middleware generates a token in the
  existing `t.<randomString(20)>` format via the existing
  `padutils.generateAuthorToken()` helper (shared between client and
  server), writes it via `res.cookie()`, and attaches it to
  `req.authorToken` for downstream handlers.
- `res.cookie()` options:
  ```js
  {
    httpOnly: true,
    secure: req.secure,                  // true on HTTPS
    sameSite: isThirdPartyIframe(req) ? 'none' : 'lax',
    maxAge: 60 * 24 * 60 * 60 * 1000,    // 60 days — same as today
    path: '/',                            // match current client-set scope
    // (`domain` intentionally unset — matches the current cookie)
  }
  ```
- `isThirdPartyIframe(req)` reuses the server's existing embed
  detection (checks `Sec-Fetch-Site: cross-site` plus referrer
  heuristics — already imported in `webaccess.ts` for session cookies).
- The cookie prefix matches `settings.cookie.prefix` so the existing
  prefixed-and-unprefixed read logic keeps working.

### Socket.io handshake reads the cookie

- `PadMessageHandler.handleClientReady` currently trusts
  `message.token`. Change the resolution order to:

  1. `socket.request.cookies[`${cp}token`]` / `cookies.token` if set —
     primary path for PR3 and every new browser.
  2. `message.token` if supplied and a non-empty string — legacy
     fallback. When this path is used, emit a one-time warn per author
     (“client is still sending token; cookie migration will take
     effect on next HTTP response”) and flag `session.legacyToken =
     true` so the Express middleware, if hit by this browser, can
     rewrite it into an HttpOnly cookie on the next request.
  3. Neither present → refuse (existing error path).

- Socket.io already parses cookies via `cookie-parser` middleware mounted
  before socket.io in `hooks/express.ts`. No extra wiring needed —
  `socket.request.cookies` is populated.

### Client JS stops touching the token

- Delete the `Cookies.get(cp+'token')`, `generateAuthorToken()`, and
  `Cookies.set(cp+'token', …)` block in
  `src/static/js/pad.ts:190-195`.
- CLIENT_READY message: drop the `token` field entirely from new
  clients. (Server still accepts it from older browsers — see above.)
- Remove unused exports:
  - `padutils.isValidAuthorToken` stays (server still validates via
    the shared helper).
  - `padutils.generateAuthorToken` — keep the helper (server uses it),
    but it is no longer called from the browser.

### IP-identity guardrail

- Add a one-line comment and a `doc/privacy.md` sentence making
  explicit that Etherpad's server-side code never falls back to
  `req.ip` for author identity. Already true; document it so a future
  commit doesn't silently regress.

## Testing

### Backend

`src/tests/backend/specs/authorTokenCookie.ts`:

1. GET `/p/<new pad>` with no cookies — response carries a
   `Set-Cookie: <prefix>token=t.<…>; HttpOnly; SameSite=Lax`,
   `Secure` asserted only when the test goes over HTTPS.
2. GET `/p/<new pad>` **again** with the `<prefix>token` cookie set
   (from the first response) — no new `Set-Cookie` for that name
   emitted. Existing value preserved.
3. Socket.io CLIENT_READY with the cookie but no `token` field —
   resolves to an authorID.
4. Socket.io CLIENT_READY with no cookie and a legacy `token` field —
   still works, warn is emitted, and a subsequent HTTP request to
   `/p/<pad>` gets a `Set-Cookie` with the same token value (so the
   browser upgrades on its own).

### Frontend (Playwright)

`src/tests/frontend-new/specs/author_token_cookie.spec.ts`:

- Fresh context opens a pad; assert `document.cookie` does **not**
  contain `<prefix>token` (the cookie exists but is HttpOnly) via
  `context.cookies()`, which returns HttpOnly cookies from Playwright's
  browser-level API. Assert the `httpOnly` / `secure` / `sameSite`
  fields are what we expect.
- Reload the pad in the same context — the user's `authorID` (from
  `clientVars.userId`) stays the same across reloads, proving the
  cookie is the real identity source.
- Open a second, isolated browser context — `authorID` differs, as
  expected for a new anonymous identity.

### Regression

- Existing pad-load + collaboration specs stay green without changes;
  they don't touch the token path directly.

## Rollout / back-compat

- **Default on.** No settings toggle — the new cookie is HttpOnly from
  day one. Operators who relied on reading `<prefix>token` from JS
  have to switch to server-side bearers (there's no legitimate reason
  for page JS to read an author token).
- Legacy `message.token` field is honoured for one release and then
  removable. A warn fires once per author session when the legacy
  path is taken.
- `token2author:<token>` storage unchanged. Hashed storage is PR5.
- `doc/cookies.md` updated: the `<prefix>token` row now lists
  `HttpOnly: true`.
