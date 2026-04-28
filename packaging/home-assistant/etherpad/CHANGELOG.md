# Changelog

## 2.6.1 (initial)

- Initial Home Assistant add-on wrapping the upstream
  `etherpad/etherpad:2.6.1` Docker image.
- Ingress support (requires `trust_proxy: true`).
- Persistent sqlite DB under `/data/etherpad.db` (ACID by default;
  `dirty` remains selectable for dev use).
- Exposes `title`, `require_authentication`, `admin_password`,
  `default_pad_text`, and DB backend selection as HA options.
