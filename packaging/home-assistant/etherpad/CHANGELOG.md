# Changelog

## 2.6.1 (initial)

- Initial Home Assistant add-on wrapping the upstream
  `etherpad/etherpad:2.6.1` Docker image.
- Ingress support (requires `trust_proxy: true`).
- Persistent dirty DB under `/data/dirty.db`.
- Exposes `title`, `require_authentication`, `admin_password`,
  `default_pad_text`, and DB backend selection as HA options.
