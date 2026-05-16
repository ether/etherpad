# PR1 — GDPR Deletion Controls

Part of the GDPR work planned in ether/etherpad#6701. This PR delivers
deletion controls: a one-time deletion token, an admin-level permission
flag, and the wiring needed for the existing "Delete pad" button to work
for token-bearers in addition to the creator cookie.

Scope deliberately excludes: author erasure, IP audits, anonymous
identity hardening, and the privacy banner. Those are PR2–PR5.

## Goals

- A pad created via the HTTP API returns a cryptographically random
  deletion token exactly once. Possession of that token is proof that
  the holder may delete the pad. The token survives cookie loss and
  device changes.
- Instance admins can widen deletion rights to any pad editor via
  `allowPadDeletionByAllUsers`, keeping the default tight.
- Browser-created pads show the token once in a copyable modal so the
  creator has a path off-device.
- No existing delete path regresses: the creator cookie still works with
  no token involvement.

## Non-goals

- Revocation / rotation of deletion tokens. A token is valid until the
  pad is deleted, at which point both pad and token go away together.
- Multi-token support per pad. One token, one pad.
- Author erasure (right-to-be-forgotten) — PR5.
- Surfacing IP-logging behaviour or a privacy banner — PR2 / PR4.

## Authorization matrix

Wired into `handlePadDelete` (socket) and `deletePad` (REST API).

| Caller | Default (`allowPadDeletionByAllUsers: false`) | `allowPadDeletionByAllUsers: true` |
| --- | --- | --- |
| Session author matches revision-0 author (creator cookie) | Allowed | Allowed |
| Supplies a deletion token that `isValidDeletionToken()` accepts | Allowed | Allowed |
| Any other pad editor | Refused with the existing "not the creator" shout | Allowed |
| Unauthorised (no session, read-only, wrong pad) | Refused | Refused |

Rationale: the token is a recovery credential, not a day-to-day
capability, so the default never silently upgrades "anyone in the pad"
to deleter. Admins opt in explicitly when that's the policy they want.

## Token lifecycle

1. On the first successful `createPad` / `createGroupPad` call,
   `PadDeletionManager.createDeletionTokenIfAbsent(padId)` generates a
   32-character random string, stores `sha256(token)` in
   `pad:<padId>:deletionToken`, and returns the plaintext token.
2. The plaintext is returned once in the API response
   (`{padID, deletionToken}`) and, for browser-created pads, streamed
   into `clientVars.padDeletionToken` on that session only.
3. The browser shows the token in a one-time modal with a Copy button
   and guidance ("save this somewhere — it is the only way to delete
   this pad if you lose your browser session"). After the modal is
   acknowledged, the token is not rendered again.
4. On delete, `Pad.remove()` calls
   `PadDeletionManager.removeDeletionToken(padId)` so DB state stays
   consistent.
5. Subsequent `createPad` calls for the same padId never regenerate the
   token (the `createDeletionTokenIfAbsent` name is load-bearing).

Storage shape already introduced in the scaffolding:

```json
{
  "createdAt": 1712451234567,
  "hash": "<sha256 hex of the token>"
}
```

`isValidDeletionToken()` uses `crypto.timingSafeEqual` on equal-length
buffers. Unknown padIds and non-string tokens return `false` without
touching the hash buffer.

## Endpoints

### Socket `PAD_DELETE`

Existing message gains an optional `deletionToken` field:

```ts
type PadDeleteMessage = {
  type: 'PAD_DELETE',
  data: {
    padId: string,
    deletionToken?: string,
  }
}
```

`handlePadDelete` authorises in order: creator cookie → valid token →
settings flag. On refusal, it emits the same shout as today.

### REST `POST /api/1/deletePad`

Accepts the existing `padID` plus an optional `deletionToken` parameter.
HTTP-authenticated admin callers (apikey) bypass the check exactly as
they do today; the token path is for unauthenticated callers who own
the credential.

### REST `POST /api/1/createPad` and `createGroupPad`

Response body adds `deletionToken: <string>` on first creation and
`deletionToken: null` on any subsequent no-op call. Other API consumers
who never read the field are unaffected.

## UI

### Post-creation modal (browser pads only)

Rendered from `pad.ts` when `clientVars.padDeletionToken` is truthy.
Shown inline after pad init, with:

- Copy-to-clipboard button.
- A localised explanation ("save this once — required to delete the pad
  if you lose your session or switch devices").
- Acknowledgement button that dismisses the modal. The token is cleared
  from the in-memory `clientVars` after acknowledgement so a page print
  / screenshot after the fact won't re-expose it from the DOM.

### Delete-by-token entry in the settings popup

Add a disclosure under the existing Delete button: "I don't have creator
cookies — delete with token" → expands a password-style input and a
confirm button. On submit, sends `PAD_DELETE` with the token.

### Existing creator flow (no change)

The creator with their original cookie presses Delete exactly like
today. No token is collected in that path.

## Settings

```jsonc
/*
 * Allow any user who can edit a pad to delete it without the one-time pad
 * deletion token. If false (default), only the original creator's author
 * cookie or the deletion token can delete the pad.
 */
"allowPadDeletionByAllUsers": false
```

Default `false` in both `settings.json.template` and
`settings.json.docker`. Threaded into `SettingsType` and `settings`
object (scaffolding already present).

## Data flow

```
createPad/createGroupPad
  └─► PadDeletionManager.createDeletionTokenIfAbsent
        └─► db.set(pad:<id>:deletionToken, {createdAt, hash})
        └─► plaintext token → API response / clientVars (browser only)

browser Delete button
  ├─ creator cookie path: socket PAD_DELETE { padId }
  └─ token path:          socket PAD_DELETE { padId, deletionToken }
        └─► handlePadDelete authorisation
              ├─ session.author === revision-0 author ⇒ allow
              ├─ isValidDeletionToken(padId, token)    ⇒ allow
              ├─ settings.allowPadDeletionByAllUsers   ⇒ allow
              └─ else                                  ⇒ shout refusal

Pad.remove()
  └─► padDeletionManager.removeDeletionToken(padId)
  └─► existing pad removal cleanup
```

## Testing

### Backend (`src/tests/backend/specs/`)

- `padDeletionManager.ts`: create / create-when-exists / verify-valid /
  verify-wrong-token / verify-unknown-pad / timing-safe equality /
  remove-on-delete.
- Extend `api/api.ts` (currently covers createPad behaviour) or add a
  sibling spec to assert `deletionToken` is present on first create and
  `null` on a duplicate call.
- Add `api/deletePad.ts` covering the four authorisation paths in the
  matrix plus the settings-flag toggle.

### Frontend (`src/tests/frontend-new/specs/`)

- `pad_deletion_token.spec.ts`: creator session creates a pad, token
  modal appears and can be dismissed; after acknowledgement the token
  is no longer reachable in `window.clientVars`.
- Same spec: second browser context (no creator cookie) opens the pad,
  supplies the captured token via the delete-by-token UI, and verifies
  the pad is removed (navigated away / confirmed gone).
- Negative case: invalid token → pad survives, shout refusal surfaces.

## Risk and migration

- Existing pads created before this PR have no stored token. First call
  to `createDeletionTokenIfAbsent` for a pre-existing padId generates
  and stores one — that's the expected upgrade path and does not change
  any already-valid deletion flow.
- `db.remove` on a non-existent key is a no-op in etherpad's db layer,
  so `removeDeletionToken` is safe to call unconditionally during pad
  removal.
- Feature flag (`allowPadDeletionByAllUsers`) defaults to the stricter
  behaviour; no existing instance sees a behavioural change unless its
  operator opts in.
