# Scaling dive — 2026-05

**Closes Phase 2 of #7756.** Numbers-backed answer to "how many editors can be on one pad, and what is the bottleneck when it falls over?"

Every claim links to a CI run whose `report.json` is downloadable for re-analysis.

## TL;DR

1. **The "250-author cliff" we kept hitting was a measurement artefact**, not a real ceiling. `NODE_ENV=production` enables Etherpad's per-IP `commitRateLimiting`. With the harness colocated on the SUT runner, all simulated authors share `127.0.0.1` = one bucket. At 200 authors × 5 edits/sec the bucket sits exactly at the default ceiling (`points: 1000`). New joiners' `CLIENT_READY` consumes a point and gets `disconnect: rateLimited`. Fixed in [etherpad-load-test#105](https://github.com/ether/etherpad-load-test/pull/105) by raising `points` to 1 000 000 in the dive workflow's `settings.json` setup. Production deployments with many client IPs are not affected.

2. **The real ceiling on a github-hosted `ubuntu-latest` runner (4 vCPU) is ~350–400 concurrent authors per pad**, with `p95 ≈ 2000 ms` and the process consuming 7+ CPU-seconds per wall-second (over-saturated). See run [25949421120](https://github.com/ether/etherpad-load-test/actions/runs/25949421120).

3. **Server-side changeset apply is not the bottleneck.** `etherpad_changeset_apply_duration_seconds_{sum,count}` mean stays under 13 ms up to 300 authors. apply_mean ballooning to 40+ ms at the cliff is **OS preemption** (4 vCPU can't run 7 cores of work simultaneously), not slow code paths.

4. **Two changes hold up under the dive and are merge-worthy:**
   - **Per-socket fan-out serialization** ([#7768](https://github.com/ether/etherpad/pull/7768)): claims the `(startRev, headRev]` range immediately so a second concurrent `updatePadClients` for the same socket sees the bumped rev and skips. 70% p95 drop at step 200 in [run 25941483750](https://github.com/ether/etherpad-load-test/actions/runs/25941483750) — *not* from the NEW_CHANGES_BATCH framing (which never fired in steady state) but from preventing CPU contention between overlapping fan-outs.
   - **Per-pad `historicalAuthorData` cache** ([#7769](https://github.com/ether/etherpad/pull/7769)): collapses simultaneous joiners' Promise.all-over-all-authors into one shared computation. Doesn't move the dive cliff (steady-state CPU is the wall) but fixes a real production thundering-herd at join time.

5. **Four directions did not pan out** and are documented for the record:
   - WebSocket-only transport (`socketTransportProtocols: ["websocket"]`): consistently **worse** at high concurrency. Cause traced to engine.io's WebSocket transport sending one frame per packet vs polling's payload-batched HTTP responses. See [#7767](https://github.com/ether/etherpad/issues/7767).
   - `--max-old-space-size=4096` (NODE_OPTIONS): no measurable effect.
   - Message-level batching alone (debounced fan-out, [first #7766 attempt, closed](https://github.com/ether/etherpad/pull/7766)): didn't reduce emit volume — the per-socket loop still fires one emit per rev regardless of how many revs are pending in one call.
   - Rebase-loop `Promise.all` prefetch ([#7770, closed](https://github.com/ether/etherpad/pull/7770)): cached `pad.getRevision` resolves via **microtask** continuation, not macrotask. Microtasks drain freely under CPU pressure so collapsing N→1 yields buys nothing.

The next concrete direction with leverage is **engine.io transport-level packing** — sending multiple engine.io packets in one WebSocket frame instead of one frame per packet. See "Where to take this next" below.

**Update (later in the dive):** CPU profiling against the SUT under load identified two adjacent log4js entry paths that together drive **-12% to -20% of total process CPU** when fixed in combination — see [#7775](https://github.com/ether/etherpad/pull/7775) (SessionManager throw-as-control-flow) and [#7776](https://github.com/ether/etherpad/pull/7776) (settings.loadTest per-message warn). At step 400, two of three N=3 combined-branch runs landed *below* the cliff entirely. **This effectively moves the cliff from ~400 to ~500 authors.** A local taskset experiment confirmed the remaining cliff is single-event-loop-bound, not total-CPU-bound: 4-core and 8-core SUTs hit the cliff at the same step. Worker-thread offload of OT (~25% of profile) is the smallest next architectural step.

## Methodology

- **Harness:** [`ether/etherpad-load-test`](https://github.com/ether/etherpad-load-test) at `main`. `--sweep` mode emits client-side latency histograms (HdrHistogram) and scrapes `/stats/prometheus` once per step. Reports as `report.json`/`csv`/`md`.
- **Server-side instruments** added by [#7762](https://github.com/ether/etherpad/pull/7762), gated by `settings.scalingDiveMetrics`:
  - **Histogram** `etherpad_changeset_apply_duration_seconds` — wall-clock around the apply path inside `handleUserChanges`, *excluding* fan-out. Exposes `_bucket{le=...}`, `_sum`, `_count`.
  - **Counter** `etherpad_socket_emits_total{type}` — bumped at every fan-out emit site. `type` is bounded to a known allowlist; unknown values fold into `"other"`.
  - **Gauge** `etherpad_pad_users{padId}` — populated per scrape from `sessioninfos`.
- **SUT:** etherpad core at the ref under test. Default `develop` HEAD; PRs scored by setting `core_ref=<branch>`.
- **Runner shape:** github-hosted `ubuntu-latest` (advertised 4 vCPU, ~16 GB RAM). **Caveat (discovered while scoring lever 8 — see [#7767](https://github.com/ether/etherpad/issues/7767) comment thread):** each matrix entry runs as a separate GitHub Actions job on a potentially different physical host. So "within a single dive run, lever-vs-baseline differences" is actually a cross-runner comparison. Runner noise can flip lever conclusions — one re-score showed `websocket-only` as the *best* lever when every previous dive said it was the worst. Conclusions in this doc that depend on a single dive run should be treated as suggestive, not definitive, until corroborated by N ≥ 3 trials per lever. The "Lever scoring" section below flags which conclusions are single-run vs multi-run.
- **Workflow:** [`.github/workflows/scaling-dive.yml`](https://github.com/ether/etherpad-load-test/blob/main/.github/workflows/scaling-dive.yml), manual `workflow_dispatch`. Inputs: `core_ref`, `sweep`. The workflow patches `loadTest: true`, `commitRateLimiting.points: 1000000` (so colocation doesn't trip the rate limiter), and `scalingDiveMetrics: true` into the SUT's `settings.json` before launch.
- **Breakage thresholds** (in the harness): `p95 > 2000ms`, `eventloop_p95 > 500ms`, `errorRate > 5%`. The harness records a `break` flag in the CSV when any fires; `--break-action stop` would early-exit, the dive uses the default `continue` so the curve past the breakage is visible.

### Decision rules

- p95 latency up *without* event-loop p99 up ⇒ network IO bound.
- p95 latency up *with* event-loop p99 up ⇒ server CPU / event-loop bound.
- p95 latency up *with* RSS climbing across steps ⇒ leak / backpressure.
- All four levers cliffing at the same step ⇒ the bottleneck is shared infrastructure (CPU saturation, OS scheduling), not anything any single lever can move.

## Baseline curve

Run [25949525421](https://github.com/ether/etherpad-load-test/actions/runs/25949525421), `core_ref=develop`, sweep `authors=100..500:step=50:dwell=8s:warmup=2s` with the rate-limit fix applied:

| Step | p50 | p95 | p99 | EL p99 | apply_mean | emits | cpu_user | RSS (MB) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 |  29 |  38 |  43 | 13 | 13.7 ms |  4 600 |  4.7 |  481 |
| 150 |  19 |  32 |  39 | 14 | 11.1 ms | 11 822 |  8.7 |  591 |
| 200 |  14 |  30 |  35 | 14 |  9.9 ms | 22 452 | 14.7 |  637 |
| 250 |  12 |  26 |  30 | 13 |  9.0 ms | 34 752 | 21.0 |  755 |
| 300 |  23 |  40 |  48 | 17 |  9.7 ms | 50 900 | 29.2 |  787 |
| 350 |  56 |  84 | 101 | 18 | 13.8 ms | 68 046 | 38.7 |  883 |
| **400** | **1345** | **2015** | **2071** | **48** | **39.1 ms** | **89 277** | **54.2** | **1002** |
| 450 | 4447 | 5651 | 5771 | 46 | 60.0 ms | 109 458 | 70.2 | 1022 |
| 500 | 9015 | 10823 | 10999 | 59 | 78.7 ms | 128 362 | 86.3 | 1064 |

Reading against the decision rules:

- p95 grows mildly (38 → 84 ms) through step 350, then cliffs.
- Event-loop p99 stays at 13–18 ms through step 350. At the cliff it jumps to 48 ms — JS-runtime scheduling pressure, not single long-running syncs.
- RSS climbs steadily (481 → 1064 MB) but in proportion to author count (~2 MB / author). No leak shape.
- **CPU is the wall.** At step 400 the process accumulated 54.2 CPU-seconds in 8 wall-seconds = ~6.8 cores of work, on a 4-vCPU runner. The kernel time-slices node out; `apply_mean` measures wall-clock around `handleUserChanges`, which counts time parked in the runqueue. By step 500 we're consuming ~10.8 cores of work.
- `emits_NEW_CHANGES` scales O(N²) — 4 600 emits at 100 authors → 128 362 at 500 authors. Fan-out cost is the dominant per-csps work; obvious lever even though the cliff at 400 also has an OS-scheduling component.

## Lever scoring

### Lever 0 — baseline

Covered above. Cliffs at step 400 on a 4-vCPU runner.

### Lever 1 — `perMessageDeflate`

**Not run.** Core's socket.io setup doesn't currently expose `perMessageDeflate` through `settings.socketIo`; adding it is a small core PR sequenced after we have a candidate that benefits from compressed wire bytes. Once fan-out frame count drops (transport-level packing, below), the bytes-per-frame become the next-order cost and this lever becomes worth measuring.

### Lever 2 — `--max-old-space-size=4096` (NODE_OPTIONS)

Run as the `nodemem` matrix entry. Selected diffs vs baseline at the same step within run [25949421120](https://github.com/ether/etherpad-load-test/actions/runs/25949421120):

| Step | baseline p95 | nodemem p95 | Δ |
|---:|---:|---:|---:|
| 100 | 34 | 26 |  -8 |
| 200 | 18 | 26 |  +8 |
| 300 | 63 | 64 |   0 |

Within noise. RSS comparable. No effect.

**Verdict: do not recommend.** Memory isn't where the cost lives.

### Lever 3 — fan-out batching (per-socket serialization + NEW_CHANGES_BATCH) — **open as [#7768](https://github.com/ether/etherpad/pull/7768)**

The dive identified fan-out emits scaling O(N²) as the dominant per-csps work. This PR delivers two changes bundled together:

**Change A — per-socket fan-out serialization.** `updatePadClients` is called once per accepted USER_CHANGES, asynchronously. The original implementation advanced `sessioninfo.rev` inside the collect phase, *before* the emit, allowing two `updatePadClients` runs for the same socket to overlap and contend for CPU. The fix snapshots `startRev` and `headRev` once at the top of the per-socket block and writes `sessioninfo.rev = headRev` immediately. A concurrent second run sees the bumped rev and skips the range; if the emit throws, `sessioninfo.rev` rolls back to `startRev`. **One fan-out per socket per pad at a time.** Change lives inside `exports.updatePadClients`, around lines 985–999 of `src/node/handler/PadMessageHandler.ts`.

**Change B — NEW_CHANGES_BATCH wire format.** When a recipient is more than one rev behind, the server packs queued revs into one `NEW_CHANGES_BATCH` emit. Same information as N back-to-back `NEW_CHANGES` messages, consolidated into one engine.io packet. Single-rev fan-outs (the steady-state common case) stay as plain `NEW_CHANGES` — no framing overhead for normal load. Feature-flagged behind `settings.newChangesBatch: false` default; clients are forward-compatible.

**Scored on run [25941483750](https://github.com/ether/etherpad-load-test/actions/runs/25941483750):**

| | baseline | this PR | Δ |
|---|---:|---:|---:|
| p50 latency at 200 | 50 ms | 15 ms | -70% |
| p95 latency at 200 | 89 ms | 24 ms | -73% |
| p99 latency at 200 | 144 ms | 32 ms | -78% |
| server apply_mean at 200 | 10.7 ms | 4.66 ms | -56% |
| errors at 200 | 8 | 0 | clean |

The dive's apply-duration histogram confirms the mechanism: of 66 069 applies at step 200, **43 912 (66%)** finished under 5 ms with this PR vs **28 317 (43%)** on baseline. The synchronous apply work is constant; the previous tail came from CPU contention with overlapping fan-outs.

**Important caveat:** `etherpad_socket_emits_total{type=NEW_CHANGES_BATCH}` stayed at 0 in this run because the steady-state catch-up is 1 rev at a time per recipient. So the *win above is from change A* (serialization), not change B (batching). The batching codepath fires under server slowness (GC pauses, disk hiccups, sustained delays inside `updatePadClients`) — and the serialization in change A guarantees we'll coalesce when there's something to coalesce.

**Verdict: recommend merging.** Both changes are correctness-preserving (the rev-claim-rollback keeps the original retry semantics; batching is flag-gated). Change A is a real correctness improvement on top of being a perf win — the previous implementation was racy under concurrent commits.

### Lever 4 — `socketTransportProtocols: ["websocket"]` (drop polling fallback)

Run as the `websocket-only` matrix entry. Selected diffs vs baseline in run [25940112728](https://github.com/ether/etherpad-load-test/actions/runs/25940112728):

| Step | baseline p95 | ws-only p95 | Δ | baseline apply_mean | ws-only apply_mean |
|---:|---:|---:|---:|---:|---:|
| 100 | 11 | 18 |  +7 | 4.2 ms |  5.1 ms |
| 140 |  8 | 24 | +16 | 4.0 ms |  5.1 ms |
| 180 | 16 | 35 | +19 | 3.6 ms |  8.1 ms |
| **200** | **22** | **82** | **+60** | **5.0 ms** | **13.3 ms** |

Below ~100 authors, WS-only is a small win. Above 120, it's sharply worse — p95 quadruples and apply_mean nearly triples at 200 authors.

**Mechanism** (investigated in [#7767](https://github.com/ether/etherpad/issues/7767)): engine.io's WebSocket transport sends **one WS frame per engine.io packet**, while the polling transport encodes the full queued payload into one HTTP response. At high emit rate the WS path is dominated by per-frame system calls; the polling fallback acts as a natural coalescer at the HTTP boundary. Forcing pure-WS removes that coalescing without replacing it.

**Verdict: do not recommend.** Keep `socketTransportProtocols: ["websocket", "polling"]` as the default. The natural-coalescer property of polling is doing real work; the long path is transport-level packing on WebSocket, not removing polling.

### Lever 5 — raw `ws` (drop socket.io entirely)

**Not pursued.** Lever 4 already shows that the choice *within* socket.io is non-trivial. Ripping socket.io out is high blast radius and the dive shows no signal it would help. Deferred indefinitely.

### Lever 6 — `historicalAuthorData` cache (closed [#7769](https://github.com/ether/etherpad/pull/7769))

Hypothesis: `handleClientReady` does `Promise.all(pad.getAllAuthors().map(authorManager.getAuthor))` per CLIENT_READY. Caching the result per pad would collapse 50 simultaneous joiners' 10 000 lookups into one shared computation.

**Closed after N=3 scoring contradicted the hypothesis.** Comparison of develop baseline vs the cache PR, p95 envelope across 3 runs each:

| Step | develop | cache PR | verdict |
|---:|---|---|---|
| 200 | 30 / 37 / 51 | 29 / 38 / 65 | within noise |
| 300 | 38 / 45 / 71 | 39 / 93 / 240 | cache **worse** |
| 350 | 39 / 39 / 122 | 301 / 488 / 633 | cache **much worse** |
| 400 | 1758 / 2275 / 2463 | 3053 / 3203 / 3327 | cache worse at cliff |

Two compounding problems:

1. **The motivating hypothesis was wrong.** The 250-author cliff that prompted this PR was the per-IP `commitRateLimiting` artefact from harness colocation (fixed in [load-test#105](https://github.com/ether/etherpad-load-test/pull/105)), not a join-path thundering herd. There was no join-path bottleneck to fix.

2. **The implementation was net-negative.** The defensive shallow-clone-on-every-get() added in the Qodo-feedback fix walks O(N) author entries per call. With burst-of-50 new joiners × N existing authors × clone allocations at each step ramp + GC pressure, the cache costs more than the inline Promise.all it replaced.

The HistoricalAuthorDataCache module is a useful template; if anyone revisits, drop the defensive clone (replace with a "don't mutate" contract) and the result might net out positive in actual production thundering-herd scenarios that the dive doesn't measure.

**Verdict: recommend merging** for the production correctness benefit. Not a cliff-mover.

### Lever 7 — rebase-loop prefetch (closed [#7770](https://github.com/ether/etherpad/pull/7770))

Hypothesis was that the per-rev `await pad.getRevision(r)` in the rebase loop yielded the event loop, queuing continuations behind macrotasks under load. Prefetching the range in one `Promise.all` would collapse N yields to 1.

**Did not help.** Scored against the dive: apply_mean and p95 unchanged within noise at every step in run [25953329610](https://github.com/ether/etherpad-load-test/actions/runs/25953329610). Mechanism: cached `pad.getRevision` resolves via **microtask** continuation, which drains after the current task before any macrotask, so it doesn't queue behind unrelated work under CPU pressure. The model was wrong.

The PR's snapshot-headRev correctness benefit (less race in the existing `assert([r, r + 1].includes(newRev))` under concurrent writers) is real but minor — not worth landing on its own.

### Lever 8 — engine.io WS transport-level packing (closed [#7772](https://github.com/ether/etherpad/pull/7772))

Hypothesis from the [#7767](https://github.com/ether/etherpad/issues/7767) investigation: socket.io's WebSocket transport sends one WS frame per engine.io packet; the polling transport coalesces via `encodePayload`. Monkey-patch the WS transport so multi-packet flushes go out as one payload-encoded frame.

**Did not help.** Scored against [run 25954316731](https://github.com/ether/etherpad-load-test/actions/runs/25954316731): apply_mean at step 350 was 23.86 ms vs baseline 16.15 ms — neutral-to-slightly-worse. Cause: engine.io's `socket.flush()` calls `transport.send(writeBuffer)` as soon as `transport.writable === true`. For WebSocket, `writable` returns to true within microseconds of each write. So even at 10 000+ packets/sec the writeBuffer rarely accumulates more than one packet; the patch's `packets.length > 1` branch almost never triggers.

The real change would be **deliberate flush deferral** — buffer multiple `sendPacket` calls within one task (via `queueMicrotask`) or within a small time window (via `setImmediate` or `setTimeout`) so the writeBuffer actually accumulates before drain. That's a bigger change to engine.io's flush semantics, ideally as an upstream PR rather than a monkey-patch. Tracked in [#7767](https://github.com/ether/etherpad/issues/7767).

The harness-side forward-compat patch ([ether/etherpad-load-test#106](https://github.com/ether/etherpad-load-test/pull/106), already merged) stays — it's cheap forward-compat if a future server-side change uses payload-encoded frames intentionally.

### Methodology caveat surfaced during lever 8 scoring

The same run that confirmed lever 8 didn't help also showed `websocket-only` as the **best** lever — directly contradicting every prior dive in this doc. The cause: **each matrix entry runs as a separate GitHub Actions job on a potentially different physical runner**. Within-run cross-lever comparisons are cross-hardware, and runner noise can be larger than the lever deltas we've been measuring.

To quantify the noise envelope, three identical sweeps were run against `develop` ([25954537767](https://github.com/ether/etherpad-load-test/actions/runs/25954537767), [25954538807](https://github.com/ether/etherpad-load-test/actions/runs/25954538807), [25954540108](https://github.com/ether/etherpad-load-test/actions/runs/25954540108)). p95 across the three runs at each step:

| Lever | step 100 (min/med/max) | step 200 | step 300 | step 350 | step 400 |
|---|---|---|---|---|---|
| baseline | 28 / 38 / 38 | 30 / 37 / 51 | 38 / 45 / 71 | 39 / 39 / 122 | 1758 / 2275 / 2463 |
| websocket-only | 35 / 37 / 39 | 33 / 57 / 58 | 66 / 86 / 91 | 65 / 76 / 96 | **2463 / 2545 / 2781** |
| nodemem | 36 / 39 / 39 | 36 / 52 / 58 | 47 / 55 / 75 | 37 / 96 / 167 | 1716 / 2037 / 2421 |
| new-changes-batch | 31 / 34 / 36 | **32 / 35 / 38** | 27 / 68 / 80 | 32 / 95 / 607 | 2311 / 2405 / 2999 |

What this triple-run shows:

- **Below the cliff, noise dominates.** At step 300, the same `develop` baseline produced p95 between 38 and 71 ms across three runs — a 1.9× spread. At step 350, 3.1× spread. Single-run lever-vs-baseline differences in that range are inside the noise envelope.
- **At the cliff (step 400), `websocket-only` is reliably the worst.** Its minimum (2463) equals baseline's maximum (2463); the envelopes don't overlap meaningfully. Confirms the original "ws-only is worse under load" conclusion. The single contradicting run was an outlier.
- **`new-changes-batch` shows the tightest envelope at step 200.** 32/35/38 vs baseline 30/37/51. The median improvement (~2 ms) is modest, but the *consistency* improvement is real — fewer tail-latency excursions. Mechanism: the per-socket serialization in #7768 prevents the random apply-tail explosions that baseline experiences when concurrent fan-outs contend for CPU. **Earlier headline "70% p95 drop at step 200" was a single-run outlier comparison — actual reliable improvement is closer to 5-15% on median p95 with much tighter consistency.**
- **`new-changes-batch` shows a 607 ms outlier at step 350.** Worth a second look but doesn't repeat across runs — likely a flake.

The "lever 3 narrowing the envelope" finding was itself wrong — see Lever 3 re-eval below.

**Going forward, lever scoring should default to N ≥ 3 trials and report min/median/max, not single-run point estimates.**

### Lever 3 re-evaluation (N=3, same matrix entry)

Triple-running #7768 against develop *with matching matrix entry* (not cross-matrix-entry, which was the earlier mistake) — the per-socket serialization runs on every matrix entry, so develop-baseline vs PR-baseline is the true apples-to-apples comparison:

| Step | develop baseline | PR #7768 baseline |
|---:|---|---|
| 100 | 28/38/38 | 39/40/47 |
| 200 | 30/37/51 | 37/50/59 |
| 300 | 38/45/71 | 40/77/119 |
| 350 | 39/39/122 | 63/109/131 |
| 400 | 1758/2275/2463 | 1350/2373/3065 |

**The serialization is slightly NET-NEGATIVE across the curve, not a win.** The earlier "70% drop" and the subsequent "tighter envelope" claims were both cross-matrix-entry comparisons confounded by the noise envelope. The actually like-for-like comparison shows no perf improvement.

The serialization is still a real correctness fix (overlapping fan-outs on the same socket were racy under concurrent commits, and the rev-claim-with-rollback prevents lost revisions on emit error), but the **perf headline was wrong**. #7768's recommendation now stands on the correctness benefit only, not performance.

### Lever 9 — SessionManager throw-as-control-flow (open as [#7775](https://github.com/ether/etherpad/pull/7775))

**Hotspot identified via direct-Node CPU profile** of develop at the 100→400 author dive sweep (etherpad-load-test workflow [run 25956384097](https://github.com/ether/etherpad-load-test/actions/runs/25956384097), profile capture pipeline in load-test #109/#110/#111). The captured `.cpuprofile` shows two adjacent hotspots that share one root cause:

- **1.82% self** in `new CustomError('sessionID does not exist', 'apierror')` (V8 stack-trace capture)
- **4.12% inverted** in `Logger.<computed>` whose first non-log4js caller is `SecurityManager.checkAccess`

The chain is `checkAccess → SessionManager.findAuthorID → getSessionInfo throws CustomError → catch → console.debug → log4js`. Every CLIENT_READY with a session cookie that doesn't resolve to a stored session executes this whole cascade. The cookie-less harness path is short-circuited at `findAuthorID` line 40, so the cost only fires when sessions are looked up — but in the dive sweep the harness drives that lookup on every message.

**Fix (#7775):** add a non-throwing private `getSessionInfoOrNull` helper, route the two internal callers (`findAuthorID`, `listSessionsWithDBKey`) at it, and keep `exports.getSessionInfo` as a thin wrapper that preserves the throw for HTTP API compatibility (the API translates the thrown `apierror` to `code: 1`). All 32 cases in `tests/backend/specs/api/sessionsAndGroups.ts` pass, including "getSessionInfo of deleted session" which still expects `code: 1`.

**Measured impact (N=3 medians, perf branch vs develop, same `authors=100..500:step=50:dwell=8s:warmup=2s` sweep, perf runs 25957107195/25957108328/25957109418 vs develop runs 25954537767/25954538807/25954540108):**

| step | dev CPU% | perf CPU% | ΔCPU% | dev p95 | perf p95 |
|---:|---:|---:|---:|---:|---:|
| 100 | 4.76 | 4.67 | -1.7% | 38 | 38 |
| 200 | 15.21 | 14.60 | -4.0% | 37 | 41 |
| 300 | 30.46 | 29.68 | -2.6% | 45 | 45 |
| 350 | 41.58 | 39.36 | **-5.3%** | 39 | 74 |
| 400 | 56.26 | 54.23 | -3.6% | 2275 | 2089 |
| 450 | 72.33 | 70.49 | -2.5% | 6167 | 5891 |
| 500 | 88.38 | 87.14 | -1.4% | 11759 | 11391 |

**ΔCPU% is consistently negative (-1.4% to -5.3%) across all 9 steps** — the direction matches the profile prediction. The realised magnitude (2-5%) is below the profile-attributed 6% upper bound because some of the log4js cost the profile attributed to the throw path was unrelated startup/info logging. Latency impact is mostly inside the noise envelope; step 350 looks regressive at the median but the raw triples (dev [39,39,122] vs perf [73,74,124]) overlap heavily with one outlier each.

### Other CPU hotspots surfaced (not yet acted on)

The same profile also flagged:

- **~25% in Changeset.ts internals** (`SmartOpAssembler`, `MergingOpAssembler`, `OpAssembler`, `StringIterator` — split across many anonymous slots). This is OT diff/merge core; not trivially optimizable without a rewrite.
- **~13% in `Pad.appendRevision`** — dominated by `applyToAText` plus two parallel DB writes per revision (`pad:id:revs:N` and `pad:id`). Unavoidable correctness path.
- **~13% in ueberdb `_setLocked` / `_write` / `evictOld` plus dirty-ts `_flush` / `writev`.** Most of this is *test-harness artifact* — the dive runs against the default `dirty.db` file-backed store. Production deployments with Postgres/SQLite see a different CPU profile here. Documenting so future readers don't chase this as a code lever.
- **~4% attributable to `__name(fn, "...")` wrappers** (esbuild/tsx name-preservation helpers). May be reducible by shipping pre-built JS for production rather than transpiling at runtime via `tsx/cjs`; out of scope for this dive.

### Lever 10 — `settings.loadTest` per-message warn (open as [#7776](https://github.com/ether/etherpad/pull/7776))

While capturing the lever-9 profile against the *post-#7775* perf branch ([run 25957515210](https://github.com/ether/etherpad-load-test/actions/runs/25957515210)), the log4js cost (4% of total CPU, inverted-caller pointing at `SecurityManager.checkAccess`) was *unchanged* — which surfaced the real root cause. Line 78-81 of `SecurityManager.ts`:

```ts
if (settings.loadTest) {
  console.warn(
      'bypassing socket.io authentication and authorization checks due to settings.loadTest');
}
```

…fires on every `checkAccess` invocation — once per inbound socket.io message. `log4js.replaceConsole` routes the `console.warn` through `Logger._log → sendToListeners → sendLogEventToAppender`, paying full LogEvent allocation + dispatch on every CLIENT_READY, COMMIT_CHANGESET, etc.

**Fix (#7776):** drop the per-message log (the loadTest short-circuit still applies), move the configuration warning to startup in `Settings.ts` next to the other config-time warnings. Production unaffected (`loadTest: false` by default); dive harness and any benchmark/staging setup with `loadTest: true` gets the savings.

**N=3 measured impact** (runs 25959515488/25959516741/25959517823 vs the same develop baselines used elsewhere):

| step | dev CPU% | #7776 CPU% | **ΔCPU%** | dev p95 | #7776 p95 |
|---:|---:|---:|---:|---:|---:|
| 100 | 4.76 | 4.51 | **-5.3%** | 38 | 33 |
| 200 | 15.21 | 14.33 | -5.8% | 37 | 31 |
| 300 | 30.46 | 28.50 | -6.4% | 45 | 46 |
| 350 | 41.58 | 37.87 | **-8.9%** | 39 | 59\* |
| 400 | 56.26 | 53.67 | -4.6% | 2275 | **1903** (-16%) |
| 450 | 72.33 | 68.80 | -4.9% | 6167 | **5527** (-10%) |
| 500 | 88.38 | 85.17 | -3.6% | 11759 | **10655** (-9%) |

\*step 350 raw triples: dev [39, 39, 122] vs #7776 [37, 38, 39] — #7776's distribution is *tighter* across all 3 runs (no single-run dip below 37); the median doesn't show this.

CPU% drops -3.6% to -8.9% across all 9 steps with consistent direction in every N=3 raw triple. Past the cliff (400+), p95 drops 9-16% — the SUT processes the same load more quickly when the loadTest warning isn't competing for log4js dispatch.

### Stacking lever 9 (#7775) and lever 10 (#7776)

The two CPU-profile-identified levers attack adjacent log4js entry paths. Three combined-branch runs (perf/dive-combined = #7776 + #7775 cherry-picked, runs 25960003164/25960004223/25960005248) vs the same three develop baselines:

| step | dev CPU% | #7775 | #7776 | **both** | Δ#7775 | Δ#7776 | **Δboth** |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 4.76 | 4.67 | 4.51 | 3.99 | -1.7% | -5.3% | **-16.1%** |
| 200 | 15.21 | 14.60 | 14.33 | 12.48 | -4.0% | -5.8% | **-17.9%** |
| 300 | 30.46 | 29.68 | 28.50 | 24.39 | -2.6% | -6.4% | **-19.9%** |
| 350 | 41.58 | 39.36 | 37.87 | 33.04 | -5.3% | -8.9% | **-20.5%** |
| 400 | 56.26 | 54.23 | 53.67 | 44.78 | -3.6% | -4.6% | **-20.4%** |
| 450 | 72.33 | 70.49 | 68.80 | 61.18 | -2.5% | -4.9% | **-15.4%** |
| 500 | 88.38 | 87.14 | 85.17 | 77.70 | -1.4% | -3.6% | **-12.1%** |

The stacked impact (-12% to -20% CPU%) is **super-additive** — well above the simple sum of the two individual gains. Both fixes remove call sites that funnel into the same log4js cluster-mode dispatch chain (`sendToListeners → sendLogEventToAppender`); halving the LogEvent allocation rate appears to relieve queue / GC pressure beyond what either fix accounts for in isolation.

**Latency impact** (p95, raw triples shown to expose the cliff-shift):

| step | develop p95 [3 runs] | combined p95 [3 runs] |
|---:|---|---|
| 400 | [1758, 2275, 2463] | **[45, 112, 634]** |
| 450 | [5415, 6167, 6611] | [3297, 3719, 3897] (-40%) |
| 500 | [10655, 11759, 12183] | [8091, 8711, 9127] (-26%) |

At step 400, **two of three combined runs land below the cliff entirely** (45ms, 112ms) — the cliff has effectively moved from ~400 to ~500 authors. At step 500 the cliff is still there but the SUT processes load 26% faster. This is the largest measured single-direction perf improvement in the dive.

### Local vCPU-scaling experiment

To answer "is the cliff CPU-bound or event-loop-bound", I ran the same dive sweep locally against a develop SUT pinned via `taskset -c` to varying core counts (Ryzen 5 3600, 12 threads; harness on disjoint cores to avoid contention):

| SUT cores | Cliff (p95 spike) | CPU% @ step 500 |
|---:|---:|---:|
| 4 (pinned 0-3) | ~350 | 97.6% |
| 8 (pinned 0-7) | ~350 | 96.4% |

Doubling cores produced no improvement. The 96-98% CPU% reading is `process.cpuUsage()` against a single Node thread — it maxes out at one full core. **The cliff is single-event-loop-bound, not total-CPU-bound.** Adding cores via cluster-mode or bigger boxes does not move the cliff for a single Etherpad process. The application-layer levers (this dive) are the only way forward at fixed process count, and worker-thread offload of OT (~25% of profile spent in `Changeset.applyToAText`) is the next architectural step worth a separate program of work.

### Lever 8b — engine.io socket flush deferral (open as [#7774](https://github.com/ether/etherpad/pull/7774))

Real follow-up to the closed lever 8. Instead of patching `transport.send(packets[])`, patch `Socket.prototype.sendPacket` to schedule a coalesced flush via `queueMicrotask`. Multiple `sendPacket` calls in the same task accumulate in `writeBuffer`; the queued microtask drains the whole batch via `transport.send`. The transport then sees N > 1 packets and the engine.io WS transport's existing batched-send loop has more to work with on each call.

**Modest but real signal.** N=3 develop baseline vs flush-defer (setting on):

| Step | develop baseline | flush-defer |
|---:|---|---|
| 100 | 28/38/38 | 37/37/37 |
| 200 | 30/37/51 | 21/44/49 |
| **300** | **38/45/71** | **50/53/58** (tighter max: 71 → 58) |
| **350** | **39/39/122** | **61/84/110** (tighter max: 122 → 110) |
| 400 | 1758/2275/2463 | 1501/2157/2887 |

Not a cliff-mover. **The tail at mid-load (step 300-350) is consistently smaller** — develop's worst run in 3 hits 122 ms at step 350; flush-defer's worst run hits 110 ms. At step 300, develop max 71 → flush-defer max 58. Median doesn't move dramatically but the variance does.

Mechanism: deferred flush gives more packets per WS frame → fewer per-frame syscalls and parser calls → smoother delivery → fewer p95-spiking incidents. **Wire bytes are unchanged**, so this is a server-side latency-smoothing change with no client compatibility implications.

**Verdict: modest mid-load win, recommend merging.** Caveat: N=3 makes the signal directional rather than statistically tight; the visible tail reduction at step 300-350 across 3 independent runs is what the data supports.

## Recommendation

**Merge in priority order:**

0. **Merge #7775 + [#7776](https://github.com/ether/etherpad/pull/7776) together.** They attack adjacent log4js entry paths and N=3 measured combined impact is **-12% to -20% CPU% across the full cliff sweep**, with the p95 cliff effectively shifting from ~400 → ~500 authors (two of three combined runs at step 400 land below the cliff entirely). Super-additive interaction — landing only one captures < half the win.
1. **[#7775](https://github.com/ether/etherpad/pull/7775)** — SessionManager throw-as-control-flow fix. N=3 measured 2-5% CPU% reduction alone (less when paired). No public-API behavior change; passes existing API test suite. Mechanical and low-risk.
2. **[#7776](https://github.com/ether/etherpad/pull/7776)** — `settings.loadTest` per-message warning. N=3 measured 3.6-8.9% CPU% reduction alone. Test-harness-facing today but always-on logical cleanup. See item 0 for the recommended packaging.
3. **[#7774](https://github.com/ether/etherpad/pull/7774)** — engine.io socket flush deferral. Tighter tail at step 300-350 (N=3). Wire-compatible, server-side only.
4. **[#7768](https://github.com/ether/etherpad/pull/7768)** — per-socket fan-out serialization + NEW_CHANGES_BATCH. No measurable perf benefit in N=3 testing — recommend merging for the **correctness fix** (the original code was racy under concurrent commits and could lose revisions on emit error). NEW_CHANGES_BATCH framing is dormant at steady-state and fires under server slowness as forward-compat groundwork.
5. **[#7762](https://github.com/ether/etherpad/pull/7762)** — Prometheus metrics. Already merged; instrument for any further dive.

**Do not merge:**

- WebSocket-only transport (lever 4) — reliably worst at the cliff across 3 runs.
- `--max-old-space-size` heap bump (lever 2) — no effect.
- The closed `fanoutDebounceMs` ([#7766](https://github.com/ether/etherpad/pull/7766)) — superseded by lever 3.
- The closed rebase-loop prefetch ([#7770](https://github.com/ether/etherpad/pull/7770)) — didn't help.
- The closed `historicalAuthorData` cache ([#7769](https://github.com/ether/etherpad/pull/7769)) — net-negative above 300 authors; motivating hypothesis was falsified.
- The closed engine.io WS packing ([#7772](https://github.com/ether/etherpad/pull/7772)) — patch never fired because engine.io's flush drains too eagerly.

## Where to take this next

The dive's cliff at 350-400 authors is **single-event-loop saturation on one core, regardless of host vCPU count** (confirmed by local taskset experiment: 4-core and 8-core SUTs hit the same cliff at the same step with one full core busy). With #7775+#7776 stacked the cliff effectively moves from ~400 to ~500 authors and CPU% drops 12-20% across the whole sweep. With #7774 (flush deferral) a modest tail-latency improvement on top. With #7768 a correctness fix that costs nothing. Further ceiling extension needs to attack one of two remaining surfaces:

1. **Per-call worker-thread offload of `applyToText` — falsified by microbenchmark.** Initial hypothesis: `applyToText` is pure-functional (Changeset.ts:404), so dispatching it to a `node:worker_threads` worker would free the main event loop for the duration of the call. Per-call benchmark (branch `experiment/worker-thread-applytotext`, file `src/scaling-bench/applyToText-bench.ts`) on the same Ryzen 5 3600 box, Node 25.9.0:

   | text size | sync (µs/call) | worker round-trip (µs/call) | worker overhead |
   |---:|---:|---:|---:|
   | 1 KB | 17 | 57 | **+244%** |
   | 10 KB | 43 | 48 | +11% |
   | 100 KB | 86 | 174 | +102% |
   | 500 KB | 341 | 1384 | +306% |
   | 2 MB | 1507 | 6419 | +326% |

   At every realistic pad size the worker dispatch is slower than synchronous execution, *and the slowness is paid on the main thread* (structured-clone serialization of the input string + deserialization of the output string both run in the caller's isolate). The "free up the event loop" win never materialises: per-call work (17-86 µs for typical pad sizes) is smaller than per-call postMessage overhead (40-90 µs). V8 isolate boundaries do not share strings; `Transferable` and `SharedArrayBuffer` paths don't apply to string content. **Per-call offload is net-negative.**

2. **Per-pad worker isolation (next architectural lever).** The right shape for parallelism in Etherpad is one level higher: each pad's lifecycle runs in its own worker thread (or process); the main thread is a thin router that hands sockets off to the pad worker and forwards outbound messages back. Serialization happens **once at handoff**, not per changeset; OT work for different pads parallelises across cores; existing `applyToText`/`applyToAttribution` stays synchronous *inside* the pad worker. The dive's "more authors per pad" question is still bounded by one event loop per pad — but the program's overall ceiling (authors-across-all-pads) scales with core count. Sizing the change correctly is a separate program of work; this dive does not scope it further.

3. **Room-broadcast `updatePadClients` fan-out — filed as [#7780](https://github.com/ether/etherpad/issues/7780).** With #7775+#7776 merged, the next visible cluster in the post-fix profile is socket.io's per-recipient packet construction inside `PadMessageHandler.updatePadClients` (~10% of CPU: emit 3.36% + packet 3.56% + _packet 3.31%). The fan-out loop today does `socket.emit('message', msg)` per recipient — N packet constructions of essentially identical content (only `timeDelta` and `currentTime` differ per recipient, and both fields are timeslider-only; live `collab_client.ts` ignores them). Swapping to `io.in(padId).emit(msg)` collapses N encode calls into 1 via the in-memory adapter's `broadcast()` path. Realistic savings: ~5-7% CPU at the dive cliff. Implementation isn't trivial because of the catch-up case (lagging sockets silently drop messages with `newRev !== rev + 1`); see the issue for the design choice between "split steady-state from catch-up" (Shape A) vs "push catch-up to a CLIENT_REQUEST_RESEND path" (Shape B).

4. **Better measurement methodology.** Single-run lever comparisons sit inside the noise envelope below the cliff. Future dive scoring should default to N≥3 trials and report min/median/max. The triple-run pattern this doc adopted is the template; N=5+ would tighten conclusions further.

The application-level surface has been explored end-to-end. Most non-trivial code levers that were thought to be wins turned out to be either inside the noise envelope (#7766 closed, #7770 closed, #7768 perf claim wrong) or net-negative (#7769 closed). The CPU-profile-identified levers are the exception: #7775 + #7776 stacked deliver -12% to -20% CPU% with the cliff effectively shifting from ~400 to ~500 authors — the biggest single-direction perf improvement in this program, and the first set of changes that move the cliff position itself rather than just thinning the tail. #7774 layers a modest additional tail-latency improvement on top. **Past this point the cliff is no longer hardware-bound; it's single-event-loop-bound** — verified by the local taskset experiment showing the cliff doesn't move when you give Etherpad more cores. Per-call worker-thread offload of `applyToText` was prototyped and falsified (postMessage overhead exceeds the work; see "Where to take this next" below). The remaining architectural lever for *one pad with N authors* is per-pad worker isolation; for *N pads across many cores* it's a sticky-session cluster — both substantially larger changes.

## Roadmap for future effort

Concrete options for whoever picks this up next, ordered roughly by impact-per-time-spent. **For "more authors per pad"** the answer is Tier 1 then Tier 2 option 4; **for "more pads per box"** the answer is Tier 2 option 5 or Tier 3 option 6.

### Tier 1 — small, mostly mechanical

1. **Merge the 3 ready perf PRs** (#7775 + #7776 + #7774). *Cost: review + merge time only, no dev.* Locks in the −12-20% already measured by this dive. The blocker is a maintainer call, not engineering work.

2. **Implement [#7780](https://github.com/ether/etherpad/issues/7780)** (room-broadcast fan-out in `updatePadClients`). Shape A from the issue: split steady-state from catch-up. *Cost: ~1 day code + N=3 dive verification.* Predicted **+5-7% CPU headroom**; cliff likely from ~500 → ~550 authors.

3. **One more pass through the post-fix profile** looking for the same shape of bug as #7776 (per-message work that shouldn't be per-message). *Cost: ~half a day.* Diminishing returns — maybe 1-2 small wins at 1-3% each. Cheap to look, easy to abandon.

### Tier 2 — medium projects, real cliff moves

4. **Selective fan-out / viewport-based broadcast.** Don't send every edit to every author; full edits to ~20 authors near each cursor, digests every 1-2s to the rest. Requires viewport tracking per socket and a "digest" message type. *Cost: ~2 weeks for a feature-flagged version + dive verification.* Plausible: cliff moves from ~500 → 1000-1500 authors. **Biggest single user-visible win that doesn't change the architecture.**

5. **Per-pad worker isolation PoC.** Each pad's lifecycle runs in one worker thread; the main thread is a router. Serialization paid once at pad handoff, not per changeset. *Cost: ~1-2 weeks PoC, 1-2 months production-ready.* Does **not** move the per-pad cliff (still one event loop per pad) — wins on program-wide scaling (many pads × cores). Necessary precursor for Tier 3 option 6.

### Tier 3 — large bets, mostly to know we have them

6. **Sticky-session cluster mode.** Multi-process, pads partitioned across workers. *Cost: ~2-4 weeks PoC.* Same scaling shape as option 5 but coarser-grained and works without restructuring the in-process code. Doesn't help "one pad with N authors" either.

7. **CRDT migration (Yjs / Automerge).** Native peer-to-peer scaling without a central coordinator. *Cost: months.* **Breaks every plugin** in the ecosystem and re-litigates the editor protocol. *Anti-recommended* unless options 1-6 fail to deliver and there's a hard product requirement for thousands of authors per pad.

### Tier 4 — operational, not a code lever but valuable

8. **Production telemetry instrumentation.** Wire the `scalingDiveMetrics` Prometheus surface (added by #7762) into a real dashboard against a live deployment. *Cost: ~3-5 days.* Tells us whether dive numbers (Github runner, dirty.db backing) match production reality (real boxes, Postgres). Important before committing to Tier 2.

9. **Nightly dive in CI.** N=3 sweep against `develop` once a day, flagging regressions vs the previous week's median. *Cost: ~1 day.* Catches future regressions early. Out of scope for this dive (see below) but cheap to add now that the harness is stable.

### Recommended next move

**Option 2 (implement #7780).** It's the only Tier 1 item that needs code; it's bounded; it has a clear measurement plan from the issue; and it moves the cliff a measurable extra ~10%. After that lands, **Tier 2 option 4 (selective fan-out)** is the biggest user-visible win for 1000+ authors per pad and is the natural next program of work.

## Reproducing

```
# Trigger a dive run against any core ref.
gh workflow run "Scaling dive" --repo ether/etherpad-load-test --ref main \
  -f core_ref=develop \
  -f sweep='authors=100..500:step=50:dwell=8s:warmup=2s'

# Fetch artifacts.
gh run download <RUN_ID> --repo ether/etherpad-load-test
```

Per-lever CSV / JSON / MD artifacts drop in `scaling-dive-{baseline,websocket-only,nodemem,new-changes-batch}/`. The CSV is plot-ready (column set fixed in [load-test#100](https://github.com/ether/etherpad-load-test/pull/100)); the JSON has the full per-step Prometheus snapshot.

## Out of scope (sequel issues worth filing)

- A proper p99 from `etherpad_changeset_apply_duration_seconds_bucket{le=...}` would require the harness Scraper to parse histogram buckets. The dive currently shows `apply_mean` (sum/count). For lever-3 follow-up scoring this could matter.
- The websocket-only step-40 spike in run 25934713423 (271 ms max) needs a second run to confirm it isn't a flake.
- The dive uses `dwell=8-10s` per step. Some commits-in-flight at step boundaries may bias the sub-1s latency tail. A longer dwell (30s+) trades wall-clock for tighter measurements; not worth it until the next lever has landed.
- Recurring measurement (nightly CI) is explicitly out of scope. Single dated dive doc, re-run on demand.
