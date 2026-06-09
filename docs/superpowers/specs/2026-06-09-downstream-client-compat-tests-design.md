# Downstream Client Compatibility Tests — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming complete)
**Target repo:** `ether/etherpad` (core), branch `develop`
**Downstream repos in scope:** `etherpad-pad` (Rust terminal editor + `etherpad-client` crate), `etherpad-cli-client` (Node/TS CLI), `etherpad-desktop` (Electron desktop + Capacitor mobile)

## Problem

The three downstream clients live in **separate repos** and consume core's wire
protocols rather than importing core as a library:

- **etherpad-cli-client** ships its *own copies* of `Changeset.ts` + `AttributePool.ts`
  and talks the socket.io `message` protocol. No test script today.
- **etherpad-pad** (Rust) hand-rolls engine.io v4 / socket.io v4 + changeset
  decoding in its `etherpad-client` crate. Has CI + a `mock-socket` test feature.
- **etherpad-desktop** wraps / points at a core server URL. Has vitest + Playwright e2e + CI.

A core PR can change the **HTTP API**, the **socket.io handshake / `message`
sequence**, or the **changeset / attribpool wire format** and break these clients
**silently**, because their CI never runs against the new core. The goal: a PR
against core `develop` (and friends) must detect downstream breakage before merge.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Detection strategy | **Hybrid**: fast contract tests in core (every PR) + downstream smoke (every PR) |
| Smoke cadence | **Every PR** (with strong flakiness mitigations) |
| How CI gets clients | **Git clone at pinned refs**, recorded in a manifest in core |
| Contract depth | **Shared golden vectors** — core generates canonical fixtures, each client decodes the same fixtures with its own decoder |
| Sequencing | **Phase by layer** — Phase 1 all core-side; Phase 2 one client repo at a time |

## Architecture

Two-layer compatibility gate on every core PR:

```
core PR ──┬─► Layer A: Contract tests (hermetic, fast, no network/clients)
          │     • golden-vector assertions (changeset/attribpool roundtrip)
          │     • socket.io message-sequence test (CLIENT_READY → CLIENT_VARS,
          │       USER_CHANGES → ACCEPT_COMMIT / NEW_CHANGES)
          │     • HTTP API shape snapshots
          │
          └─► Layer B: Downstream smoke (boots a real server, runs real clients)
                • build + boot Etherpad from the PR on :9003 with a known API key
                • healthcheck-poll until ready
                • matrix over manifest: clone client @ pinned ref, set up toolchain,
                  inject core's freshly-generated vectors, run client `test:vectors`,
                  run client smoke: connect → create/open pad → write text →
                  read back via HTTP API → assert equality
                • tear down server by PID
```

## Layer A — Contract tests (Phase 1, core)

### Golden vectors
- Generator script: `src/tests/downstream/generate-vectors.ts` (run via a package
  script, e.g. `pnpm run vectors:gen`).
- Output fixture: `src/tests/fixtures/wire-vectors.json`. Each record:
  `{ name, initialAText, changeset, pool, resultAText }` covering the operation
  classes clients must decode: plain insert, delete, format/attrib op,
  multi-line insert (char_bank ending in `\n`), attribpool reuse across ops.
- Core test `src/tests/backend/specs/wire-vectors.ts`: regenerate in-memory and
  assert it matches the committed fixture exactly (drift requires a deliberate
  commit, which is the signal a wire change happened).

### Socket message-sequence test
- `src/tests/backend/specs/wire-socket-sequence.ts`: drive a socket.io client
  against the in-process server, assert the handshake message sequence and the
  shape of `CLIENT_VARS`, `USER_CHANGES` → `ACCEPT_COMMIT`, and broadcast
  `NEW_CHANGES`. Reuses the existing backend socket test helpers.

### HTTP API shape snapshots
- `src/tests/backend/specs/wire-http-api.ts`: snapshot the response *shapes*
  (keys / types, not volatile values) of the API endpoints clients call
  (`createPad`, `setText`, `getText`, `getRevisionsCount`, session/auth as needed).

These join the existing `backend-tests.yml` run — no new per-PR job, no new infra.

## Layer B — Downstream smoke (Phase 1 scaffold, Phase 2 per client)

### Manifest
`src/tests/downstream/clients.json`:
```json
[
  { "name": "etherpad-pad",        "repo": "https://github.com/ether/pad.git",                 "ref": "<sha on main>", "kind": "rust",    "smokeCmd": "..." },
  { "name": "etherpad-cli-client", "repo": "https://github.com/ether/etherpad-cli-client.git", "ref": "<sha on main>", "kind": "node",    "smokeCmd": "..." },
  { "name": "etherpad-desktop",    "repo": "https://github.com/ether/etherpad-desktop.git",     "ref": "<sha on main>", "kind": "desktop", "smokeCmd": "..." }
]
```
Refs are pinned to a specific commit SHA (not `main`) so a client's own pushes
cannot redden core CI; bumping a ref is a deliberate PR. Current `main` HEADs at
authoring time: pad `31176d6`, cli-client `edbe0bb`, desktop `ad273c1`.
Pinned refs mean a client's *own* breakage never randomly reddens core; picking up
a client fix is a deliberate ref-bump PR. Clients are added to the manifest as
their Phase-2 smoke lands — the workflow only runs what's registered.

### Workflow
`.github/workflows/downstream-smoke.yml` (triggers: `pull_request` + nightly
`schedule` against `develop`):
1. Build core from the PR, install deps.
2. Boot Etherpad on **:9003** with a known `APIKEY` in the background; record PID.
3. Healthcheck-poll the server (bounded timeout) before proceeding.
4. Matrix over manifest entries: clone @ pinned ref → set up toolchain
   (node+pnpm / rust / electron+xvfb) → copy core's freshly-generated
   `wire-vectors.json` into the client → run `test:vectors` → run smoke.
5. Tear down: kill the recorded **PID** (never `pkill -f`).

### Per-client smoke (Phase 2)
Minimal roundtrip exercising the real protocol end-to-end:
- **etherpad-pad** (`rust`): integration test gated by `ETHERPAD_SMOKE_URL`, using
  the real tungstenite socket — connect, open pad, send a changeset, read back
  via HTTP `getText`, assert. Plus `cargo test` vector consumer reading the
  injected fixture.
- **etherpad-cli-client** (`node`): add a minimal test runner (none today —
  `node:test` or vitest), a `test:vectors` decoding the fixture, and a smoke
  using the client lib: connect → write → verify via HTTP `getText`.
- **etherpad-desktop** (`desktop`): **headless-light** vitest smoke that points
  the shell/webview at the booted URL and roundtrips. The full Electron e2e stays
  in desktop's own CI — it is **not** in the core gate. If Electron is
  unavoidable here, run under `xvfb-run`.

## Flakiness mitigations (because smoke runs on every PR)

- Healthcheck-poll-with-timeout before any client runs.
- Bounded timeout + 1 retry per client smoke.
- Desktop kept headless-light; heavy Electron e2e excluded from the gate.
- PID-based teardown, never `pkill -f` (would kill the developer's other servers).
- Pinned manifest refs isolate core CI from clients' own breakage.
- Tests that bind a port use **:9003** (9001 is reserved for ad-hoc local use).

## Phasing

- **Phase 1 (core only, lands first, immediately useful):** vector generator +
  `wire-vectors.json` + three contract specs + `downstream-smoke.yml` +
  `clients.json` manifest. Harness proven with **one** reference client wired in
  (the Rust `etherpad-pad`, which already has test infra).
- **Phase 2 (one client repo at a time):** order `etherpad-pad` →
  `etherpad-cli-client` → `etherpad-desktop`. Each PR adds that client's
  `test:vectors` + smoke and registers it in the core manifest.

## Out of scope

- Replacing clients' existing full e2e suites (they stay in their own repos).
- ep_kaput (excluded from all sweeps per standing instruction).
- Changing the wire protocol itself — this work only *observes* it.

## Success criteria

- A core PR that alters changeset serialization, the socket message sequence, or a
  client-facing API shape fails Layer A (contract) and/or Layer B (smoke) before merge.
- Phase 1 lands green on core `develop` with the Rust client wired into the smoke matrix.
- Bumping a client's pinned ref is the only way a client's own changes affect core CI.
