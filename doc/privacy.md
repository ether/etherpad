# Privacy

See [cookies.md](cookies.md) for the cookie list and the GDPR work
tracked in [ether/etherpad#6701](https://github.com/ether/etherpad/issues/6701).
The full operator-facing privacy statement (including IP-logging
behaviour) is covered by the companion PR that lands alongside this
change.

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
