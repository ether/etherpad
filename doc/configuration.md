# Configuration

This page explains how Etherpad is configured and documents the
reverse-proxy and subpath behaviour in detail. It is **not** an exhaustive list
of every setting — for that, see the fully-commented
[`settings.json.template`](https://github.com/ether/etherpad/blob/develop/settings.json.template),
which is the authoritative reference.

## Where settings live

Etherpad reads its configuration from `settings.json` in the installation root.
A new install copies `settings.json.template` to `settings.json` on first run.

* **Override the file location** by passing the `-s` / `--settings` flag to
  the launcher, e.g. `bin/run.sh -s /etc/etherpad/settings.json`. This lets
  you run multiple instances from one installation. (`bin/run.sh` forwards the
  flag to `pnpm run prod`, which is the supported entrypoint — there is no
  `server.js`; the runtime is `src/node/server.ts`, loaded via `tsx`.)
* **Environment-variable substitution** — any string value may reference an
  environment variable using the syntax `"${ENV_VAR}"` or
  `"${ENV_VAR:default}"`. The variable name **must** be quoted, even when the
  resolved value is a number or boolean. A few rules worth remembering:
  * `"${PORT:9001}"` → the value of `PORT`, or `9001` if unset.
  * `"${MINIFY:true}"` → the boolean `true`/`false`, not the string.
  * `"${UNSET_VAR:null}"` → `null`; `"${UNSET_VAR:}"` → the empty string.
  * Substitution happens at load time, in memory only — env vars never
    overwrite `settings.json` on disk.

When running in Docker, almost every setting is wired to an environment
variable in the shipped `settings.json.docker`. See the
[Docker page](/docker.md) for the full env-var list.

## Trusting a reverse proxy

If Etherpad runs behind NGINX, Traefik, HAProxy, a Kubernetes ingress, or any
other reverse proxy, set:

```json
"trustProxy": true
```

This makes Etherpad trust the standard `X-Forwarded-*` headers, so it:

* uses the real client IP (from `X-Forwarded-For`) in logs and rate limits
  instead of the proxy's IP;
* respects the forwarded protocol and host, so the `secure` flag is set on
  cookies when the proxy terminates TLS (required for `SameSite=None`).

Leave it at the default `false` when Etherpad is reachable directly on a public
IP — otherwise any client could forge these headers.

## Running under a subpath / ingress

Etherpad can be served under a URL-path prefix (for example
`https://example.com/etherpad/`) without recompiling anything. The prefix is
discovered per-request from upstream headers, so the same Etherpad process works
whether it is mounted at the root or under a path.

Three headers are checked, **in this order**; the first non-empty value (after
sanitization) wins:

| Order | Header | Origin | Requires `trustProxy: true`? |
| ----- | ------ | ------ | ---------------------------- |
| 1 | `x-proxy-path` | Etherpad's own convention | No — always honoured |
| 2 | `X-Forwarded-Prefix` | HAProxy / Traefik / Spring | Yes |
| 3 | `X-Ingress-Path` | Kubernetes / Home Assistant ingress | Yes |

`x-proxy-path` is always honoured because an operator must deliberately
configure their proxy to send Etherpad's custom header. The two standard
headers (`X-Forwarded-Prefix`, `X-Ingress-Path`) are honoured **only when
`trustProxy` is `true`**, because otherwise a client on a public IP could forge
them.

Once detected, the prefix is woven into the responses that would otherwise
break under a subpath:

* `manifest.json` (PWA install metadata);
* the social-media meta tags (`og:url` / `og:image`), unless an explicit
  `publicURL` is configured;
* the bootstrap script entrypoint and the asset / reconnect links in the pad,
  index, and timeslider pages.

### Sanitization

The header value is treated as untrusted input even when read from a trusted
header, because it ends up inside HTML, JS, CSS, and HTTP `Location` headers.
The sanitizer (`src/node/utils/sanitizeProxyPath.ts`):

* strips every character outside `[A-Za-z0-9_./-]`;
* collapses a leading `//+` to a single `/`, so the value can never be read as
  a protocol-relative URL;
* prepends `/` if the result doesn't already start with one;
* **rejects** any value containing a `..` path segment (returns empty).

The output is therefore always either empty, or a string that starts with
exactly one `/` and contains only `[A-Za-z0-9_./-]`.

### Example: Traefik

```yaml
http:
  middlewares:
    etherpad-prefix:
      stripPrefix:
        prefixes:
          - "/etherpad"
    etherpad-headers:
      headers:
        customRequestHeaders:
          X-Forwarded-Prefix: "/etherpad"
```

Apply both middlewares to the router and set `trustProxy: true` in
`settings.json`.

### Example: NGINX

```nginx
location /etherpad/ {
    proxy_pass http://127.0.0.1:9001/;
    proxy_set_header X-Proxy-Path /etherpad;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Here `X-Proxy-Path` is used, which works regardless of `trustProxy`. Use
`X-Forwarded-Prefix` instead if you prefer the standard header (and set
`trustProxy: true`).

## Self-update, email, database, and metrics

These areas have their own pages:

* **Self-update** and **outbound email** (`adminEmail`, `mail.*` SMTP) —
  see [Updates](/admin/updates.md). The corresponding Docker env vars
  (`MAIL_HOST`, `MAIL_FROM`, …) are listed on the [Docker page](/docker.md).
* **Database** — choose a backend with `dbType` / `dbSettings`. The
  supported drivers and example settings are documented in
  [`settings.json.template`](https://github.com/ether/etherpad-lite/blob/develop/settings.json.template),
  and the Docker equivalents (`DB_TYPE`, `DB_HOST`, …) are listed on the
  [Docker page](/docker.md). The on-disk keyspace layout is described in
  [`doc/database.adoc`](https://github.com/ether/etherpad-lite/blob/develop/doc/database.adoc).
* **Metrics** — Etherpad exposes Prometheus-compatible metrics; see
  [Stats](/stats.md).
