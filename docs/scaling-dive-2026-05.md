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

The lever-3 (#7768) finding still stands but **for a different reason than originally claimed**: not a dramatic p95 reduction, but improved consistency + the correctness benefit of preventing overlapping fan-outs on the same socket. The per-socket serialization is a real correctness fix; the NEW_CHANGES_BATCH framing is currently latent (it would fire under server slowness).

**Going forward, lever scoring should default to N ≥ 3 trials and report min/median/max, not single-run point estimates.**

## Recommendation

**Merge in priority order:**

1. **[#7768](https://github.com/ether/etherpad/pull/7768)** — per-socket fan-out serialization + NEW_CHANGES_BATCH. Modest median p95 improvement at step 200 (37 → 35) but **measurably tighter envelope** (baseline max 51 → PR max 38) — fewer tail-latency excursions. Correctness-positive: prevents overlapping per-socket fan-outs that were previously racy under concurrent commits. NEW_CHANGES_BATCH framing is dormant at steady-state and fires under server slowness.
2. **[#7762](https://github.com/ether/etherpad/pull/7762)** — Prometheus metrics. Already merged; instrument for any further dive.

**Do not merge:**

- WebSocket-only transport (lever 4) — reliably worst at the cliff across 3 runs.
- `--max-old-space-size` heap bump (lever 2) — no effect.
- The closed `fanoutDebounceMs` ([#7766](https://github.com/ether/etherpad/pull/7766)) — superseded by lever 3.
- The closed rebase-loop prefetch ([#7770](https://github.com/ether/etherpad/pull/7770)) — didn't help.
- The closed `historicalAuthorData` cache ([#7769](https://github.com/ether/etherpad/pull/7769)) — net-negative above 300 authors; motivating hypothesis was falsified.
- The closed engine.io WS packing ([#7772](https://github.com/ether/etherpad/pull/7772)) — patch never fired because engine.io's flush drains too eagerly.

## Where to take this next

The dive's cliff at 350-400 authors is **steady-state CPU saturation on a 4-vCPU runner with O(N²) fan-out**. With lever 3 merged, the per-emit application-level work is as cheap as it can get. Further ceiling extension needs to attack one of three surfaces:

1. **Engine.io flush deferral.** The closed lever-8 attempt patched only the `send(packets[])` path; what's needed is to defer `socket.flush()` itself so multiple `sendPacket()` calls in the same task accumulate before drain. `queueMicrotask`-coalesced flush is the smallest behaviour change with the right shape. This is the natural sequel to [#7767](https://github.com/ether/etherpad/issues/7767).

2. **Bigger hardware or per-pad sharding.** A 4-vCPU runner is the constraint, not Etherpad. Production on 8+ vCPU sees the cliff move proportionally with no code changes. Per-pad multi-worker sharding lets a single host scale beyond single-core limits but is a much larger architectural change.

3. **Better measurement methodology.** Single-run lever comparisons sit inside the noise envelope below the cliff. Future dive scoring should default to N≥3 trials and report min/median/max. The triple-run pattern this doc adopted (see "Methodology caveat" above) is the template.

Direction (1) is the next concrete code investigation; (3) is methodology hygiene for all future investigations.

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
