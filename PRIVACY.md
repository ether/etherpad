# Privacy in Etherpad

## What this document is

A complete, current list of every network call Etherpad's own code makes
to a third party, plus how to turn each one off. Plugins are out of
scope — audit any plugin you install.

## TL;DR

Etherpad ships with two outbound calls to `etherpad.org`. Both are
documented below. Both can be disabled with a single config value each.
No analytics, no usage pings, no third-party SDKs at runtime.

## Outbound calls

### 1. Version check

| | |
|---|---|
| URL       | `https://static.etherpad.org/info.json` (override via `updateServer`) |
| Frequency | hourly while the server runs |
| Payload   | GET only; `User-Agent: Etherpad/<version>` |
| Purpose   | surface an "update available" notice in the admin panel |
| Disable   | set `privacy.updateCheck: false` in `settings.json` |
| Source    | `src/node/utils/UpdateCheck.ts` |

### 2. Plugin catalog

| | |
|---|---|
| URL       | `https://static.etherpad.org/plugins.json` (override via `updateServer`) |
| Frequency | on admin-plugins page load (cached 10 min) |
| Payload   | GET only; same `User-Agent` |
| Purpose   | list installable `ep_*` plugins in the admin UI |
| Disable   | set `privacy.pluginCatalog: false` in `settings.json` (manual install via CLI still works) |
| Source    | `src/static/js/pluginfw/installer.ts` |

## What we removed

`swagger-ui-express` was dropped because the upstream npm package
injects a Scarf analytics pixel that cannot be disabled at install or
runtime (see [swagger-api/swagger-ui#10573](https://github.com/swagger-api/swagger-ui/issues/10573)).
`/api-docs` is now served by a vendored copy of [RapiDoc](https://rapidocweb.com/)
(MIT) with no outbound calls. The shell explicitly opts out of RapiDoc's
default Google-Fonts fetch by setting `load-fonts="false"` and explicit
system-font stacks.

`@scarf/scarf` is listed under `ignoredBuiltDependencies` in
`pnpm-workspace.yaml`, so its postinstall pixel is suppressed even if a
future transitive dep pulls Scarf in.

## What we will not add

- usage analytics or telemetry SDKs
- crash reporters that send data without explicit opt-in
- third-party CDN dependencies at runtime
- dependencies whose install or runtime phones home

## Plugins

Third-party plugins are out of this guarantee. Plugins run in your
Etherpad process with full access; audit any plugin you install.

## Reporting

Found an outbound call this doc doesn't list? Open an issue with the
label `privacy`.
