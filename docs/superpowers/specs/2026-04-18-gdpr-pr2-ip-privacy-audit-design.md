# PR2 — GDPR IP / Privacy Audit

Second of five GDPR PRs tracked in ether/etherpad#6701. Outcome of the audit is
three things: (a) fix four current leaks where `disableIPlogging` is silently
ignored, (b) move from a boolean flag to a tri-state `ipLogging` setting so
operators can keep aggregate diagnostics without retaining personal data, (c)
ship `doc/privacy.md` so deployments can state their legal position truthfully.

## Audit summary

Grep of `src/node/` for `request.ip`, `handshake.address`, `remoteAddress`,
`x-forwarded-for`, `disableIPlogging`, and `clientIp` yields the following
sites. "Persisted" means written outside process memory.

| Location | Uses IP | Respects `disableIPlogging` | Persisted |
| --- | --- | --- | --- |
| `PadMessageHandler.accessLogger` ENTER/CREATE (L913–916) | yes | **yes** | only if log4js has a file appender |
| `PadMessageHandler.accessLogger` LEAVE (L204–207) | yes | **yes** | same |
| `PadMessageHandler.accessLogger` CHANGES (L342) | yes | **yes** | same |
| `PadMessageHandler` rate-limit warn (L280) | yes | **no** — leak | same |
| `SocketIORouter.ts:64` connect log | yes | **yes** | same |
| `webaccess.ts:181` auth-failure log | yes | **no** — leak | same |
| `webaccess.ts:208` auth-success log | yes | **no** — leak | same |
| `hooks/express/importexport.ts:22` rate-limit warn | yes | **no** — leak | same |
| `PadMessageHandler` rate-limit key (L278) | yes (in-memory key) | n/a | no |
| `clientVars.clientIp` literal `'127.0.0.1'` (L1022, L1030) | no (placeholder) | n/a | pushed to every browser |
| Express connect logger (`hooks/express.ts:179`) | no (`:status, :method :url`) | n/a | same |

**No code path writes an IP to the Etherpad database.** The only IP sink is
`log4js`; persistence depends entirely on whether the operator configured a
file appender or forwards stdout to a log aggregator.

## Goals

- Make `disableIPlogging` behaviour honest: every log-site that emits an IP
  runs through the same helper so the flag cannot leak.
- Replace the binary flag with a three-valued setting so operators can keep
  aggregate visibility (rate-limiter behaviour, geographic distribution) while
  stripping the personally identifying bits.
- Keep 100% backwards compatibility with the existing boolean via a
  deprecation shim.
- Ship clear operator-facing documentation stating what Etherpad stores
  about IPs at each level.

## Non-goals

- Changing the in-memory rate-limit key. It must remain the raw IP; the key
  is never persisted and is the whole point of rate limiting.
- Removing IPs from plugin hook payloads. Plugins that currently receive IPs
  do so via the same request object; altering that is a plugin-compat break
  and belongs in a follow-up.
- Audit-log compliance (append-only / retention). Out of scope.
- Author erasure, deletion token work, identity hardening, privacy banner —
  those are PR1 (shipped), PR3, PR4, PR5.

## Design

### Settings

```jsonc
/*
 * Controls what Etherpad writes to its logs about client IP addresses.
 *
 *   "anonymous" — replace every IP with the literal string "ANONYMOUS" (default)
 *   "truncated" — zero the last octet of IPv4 (1.2.3.0) and the last 80 bits
 *                 of IPv6 (2001:db8:1234:5678:: → 2001:db8:1234::). Keeps
 *                 aggregate visibility, satisfies GDPR Art. 4 for most DPAs.
 *   "full"      — log the full IP. Choose only with documented legal basis
 *                 and a retention policy.
 *
 * None of these settings changes in-memory rate-limiting, which always keys
 * on the raw IP for the duration of the limiter window and never persists.
 */
"ipLogging": "anonymous"
```

- `SettingsType.ipLogging: 'full' | 'truncated' | 'anonymous'`.
- On load, if `settings.disableIPlogging` is a boolean:
  - emit `logger.warn('disableIPlogging is deprecated; use ipLogging instead')`,
  - map `true` → `'anonymous'`, `false` → `'full'`,
  - copy into `settings.ipLogging` **only if** the operator did not also set
    `ipLogging` (explicit new setting wins).
- `disableIPlogging` remains on the type for one release cycle so plugins
  that read it don't TypeError; no code path inside Etherpad reads it
  anymore.

### `anonymizeIp(ip, mode)` helper

New file `src/node/utils/anonymizeIp.ts`:

```typescript
import {isIP} from 'node:net';

export type IpLogging = 'full' | 'truncated' | 'anonymous';

const IPV4_MAPPED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

export const anonymizeIp = (ip: string | null | undefined, mode: IpLogging): string => {
  if (ip == null || ip === '') return 'ANONYMOUS';
  if (mode === 'anonymous') return 'ANONYMOUS';
  if (mode === 'full') return ip;
  // "truncated"
  const mapped = IPV4_MAPPED.exec(ip);
  if (mapped != null) return `::ffff:${mapped[1].replace(/\.\d+$/, '.0')}`;
  switch (isIP(ip)) {
    case 4: return ip.replace(/\.\d+$/, '.0');
    case 6: return truncateIpv6(ip);
    default: return 'ANONYMOUS'; // refuse to emit things that are not IPs
  }
};
```

- IPv4: zero the last octet (`1.2.3.4` → `1.2.3.0`).
- IPv4-mapped IPv6 (`::ffff:1.2.3.4`): treat the embedded v4 and re-wrap.
- Pure IPv6: `truncateIpv6()` keeps the first 48 bits (three 16-bit groups),
  drops the remaining 80 bits, collapses trailing zeros with `::`. That is
  the prefix most residential and mobile operators publicly expose, so
  truncated logs still show meaningful aggregate clustering without
  identifying a household.
- Unit-testable pure function; no import of `settings`.

### Wiring

Single point of use in every leaking site:

```typescript
import settings from '../utils/Settings';
import {anonymizeIp} from '../utils/anonymizeIp';
const logIp = (ip: string | null | undefined) => anonymizeIp(ip, settings.ipLogging);
```

Replacements:

| File | Before | After |
| --- | --- | --- |
| `PadMessageHandler.ts` ENTER/CREATE/LEAVE/CHANGES | `settings.disableIPlogging ? 'ANONYMOUS' : socket.request.ip` | `logIp(socket.request.ip)` |
| `PadMessageHandler.ts:280` rate-limit warn | `\`Rate limited IP ${socket.request.ip}\`` | `\`Rate limited IP ${logIp(socket.request.ip)}\`` |
| `SocketIORouter.ts:64` | existing ternary | `logIp(socket.request.ip)` |
| `webaccess.ts:181,208` | `req.ip` | `logIp(req.ip)` |
| `hooks/express/importexport.ts:22` | `request.ip` | `logIp(request.ip)` |

### `clientVars.clientIp` cleanup

Currently set to the literal `'127.0.0.1'` in two places and plumbed into the
`ClientVarPayload.clientIp: string` type. Nothing on the client uses it; grep
of `src/static` confirms.

- Remove the field from both assignments.
- Remove `clientIp: string` from `ClientVarPayload`.
- Keep the unused getter `pad.getClientIp` (plugin-facing) but have it return
  `null`. Add one-line JSDoc noting it's retained for plugin-compat.

### Documentation

Create `doc/privacy.md`:

1. What Etherpad stores about you (pad content, author cookie, session
   cookie, chat messages, revision metadata — none of which is an IP).
2. What Etherpad logs about you (reference the audit table above, summarised).
3. How to configure IP logging: show the three `ipLogging` values and what
   each looks like in the access log.
4. What Etherpad does **not** do (persist IPs to the DB, send IPs to third
   parties, include IPs in plugin hook state by default).
5. Rate-limiting note: raw IP held in memory for the limiter window, never
   written to disk by Etherpad itself.

Cross-link from `doc/settings.md` at the existing `disableIPlogging` entry.

## Testing

### Unit

`src/tests/backend/specs/anonymizeIp.ts`:

- Valid IPv4: truncated → `1.2.3.0`; full → unchanged; anonymous → `ANONYMOUS`.
- Valid IPv6 compressed (`2001:db8::1`): truncated → `2001:db8::`.
- Valid IPv6 full form (`2001:db8:1:2:3:4:5:6`): truncated → `2001:db8:1::`.
- IPv4-mapped IPv6 (`::ffff:1.2.3.4`): truncated zeros last octet of the
  embedded v4 (`::ffff:1.2.3.0`).
- Invalid / empty / null / non-IP strings → `ANONYMOUS` regardless of mode.

### Backend integration

`src/tests/backend/specs/ipLoggingSetting.ts`:

- Mount a log4js memory appender, drive a CLIENT_READY through
  `PadMessageHandler` for each of the three `ipLogging` modes, assert the
  emitted `[CREATE]` / `[ENTER]` record contains the expected redaction.
- One more case: set the legacy boolean `disableIPlogging = true` only,
  assert the deprecation warning fires once at load and that the access log
  emits `ANONYMOUS`.

### No Playwright

This PR is log-layer only; nothing to exercise in the browser.

## Risk and migration

- Operators reading logs with scripts that assume `ANONYMOUS` will keep
  seeing it under the default.
- Operators who explicitly set `disableIPlogging: false` retained full
  logging; after upgrade they get full logging via the shim and a WARN.
- Operators with custom appenders or log aggregators get the same text
  they got before for the default case, so existing dashboards do not break.
- `clientIp` removal is safe — grep confirms no client code reads it and
  its value was always `'127.0.0.1'`.
