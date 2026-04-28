# Privacy

See [cookies.md](cookies.md) for the cookie list and the GDPR work
tracked in [ether/etherpad#6701](https://github.com/ether/etherpad/issues/6701).

## Right to erasure (GDPR Art. 17)

Etherpad anonymises an author rather than deleting their changesets
(deletion would corrupt every pad they contributed to). Operators
trigger erasure via the admin REST API:

```bash
curl -X POST \
  -H "Authorization: Bearer <admin JWT / apikey>" \
  "https://<instance>/api/1.3.1/anonymizeAuthor?authorID=a.XXXXXXXXXXXXXX"
```

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
short-circuits the second time and returns zero counters.
