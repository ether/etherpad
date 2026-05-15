# Scaling dive — 2026-05

**Closes Phase 2 of #7756.** First numbers-backed answer to "how many editors can be on one pad, and what is the bottleneck when it falls over?"

## TL;DR

Two clean conclusions from three matrix runs on the same GitHub-hosted `ubuntu-latest` runner shape:

1. **Server-side changeset apply is not the bottleneck.** Even at 200 concurrent authors, `etherpad_changeset_apply_duration_seconds` mean is ~3.7–4.4 ms — well under client-perceived p95 (~20–25 ms). The remaining latency lives in *fan-out*, not in *apply*.
2. **Dropping the socket.io polling fallback (`socketTransportProtocols: ["websocket"]`) makes things worse, not better, under high concurrency.** At 200 authors it nearly doubles client p95 (37 ms vs 20 ms baseline). The hypothesis that the polling fallback was costing us is falsified.

Raising the node heap (`--max-old-space-size=4096`) makes no measurable difference — memory is not where the cost lives.

Next step: prototype the **fan-out batching** lever (spec section 9 lever 3). Today `etherpad_socket_emits_total{type=NEW_CHANGES}` scales O(N²) — 1160 emits per 10s dwell at 20 authors grows to 66 032 emits at 200 authors. Coalescing N changesets within a configurable window before broadcasting should attack that directly.

## Methodology

- **Harness:** [`ether/etherpad-load-test`](https://github.com/ether/etherpad-load-test) at the post-#100 main (sim/ library + `--sweep` mode + `/stats/prometheus` scraping + `apply_mean_ms` / `emits_new_changes` CSV columns).
- **Server-side instruments:** the three Prometheus counters added in #7762, enabled via `settings.scalingDiveMetrics=true`.
- **SUT:** etherpad core `develop` HEAD at the time of run.
- **Runner shape:** GitHub-hosted `ubuntu-latest` (4 vCPU, ~16 GB RAM). Same shape across all three matrix entries, so noise is constant.
- **Workflow:** [`.github/workflows/scaling-dive.yml`](https://github.com/ether/etherpad-load-test/blob/main/.github/workflows/scaling-dive.yml), manual `workflow_dispatch`. Two runs analysed:
  - **Run 25936626554** — default sweep `authors=10..80:step=10:dwell=15s:warmup=3s`.
  - **Run 25936813657** — deeper sweep `authors=20..200:step=20:dwell=10s:warmup=2s` (used for the conclusions below).

### Decision rules (per spec section 6)

- p95 latency up *without* event-loop p99 up ⇒ network IO bound.
- p95 latency up *with* event-loop p99 up ⇒ server CPU / event-loop bound.
- p95 latency up *with* RSS climbing across steps ⇒ leak / backpressure.

## Baseline curve

The deep sweep on baseline (no levers, develop HEAD):

| Step | p50 | p95 | p99 | EL p99 | apply_mean | emits_NEW_CHANGES | cpu_user (s) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 20  |  9 | 11 | 12 | 11 | 4.84 ms |  1 160 |  2.4 |
| 40  |  8 | 11 | 12 | 12 | 4.62 ms |  3 520 |  4.0 |
| 60  |  8 | 11 | 13 | 12 | 4.63 ms |  7 040 |  6.3 |
| 80  | 10 | 17 | 19 | 12 | 5.18 ms | 11 780 |  9.5 |
| 100 |  8 | 16 | 18 | 11 | 5.08 ms | 17 668 | 13.0 |
| 120 |  5 | 12 | 16 | 11 | 4.55 ms | 24 793 | 17.5 |
| 140 |  3 |  8 | 11 | 11 | 3.96 ms | 33 088 | 22.8 |
| 160 |  4 |  9 | 11 | 11 | 3.62 ms | 42 563 | 29.0 |
| 180 |  5 | 16 | 20 | 12 | 3.56 ms | 54 112 | 36.5 |
| 200 |  7 | 20 | 25 | 12 | 3.67 ms | 66 032 | 44.0 |

Reading against the decision rules:

- p95 grows slowly (11 → 20 ms across the range), but doesn't cliff.
- Event-loop p99 stays at 11–12 ms — flat. **Not event-loop bound.**
- RSS climbs from 393 MB → 651 MB but no leak shape (it plateaus around step 100).
- CPU is the headline: 200 authors burns 44 CPU-seconds in 10 s wall-clock — ~4.4 cores. The runner has 4 vCPU. We're saturating the CPU on fan-out work.

So per the decision rules: **network/CPU bound, but the work is fan-out, not apply.** The `apply_mean` stays low while emits grow O(N²) with concurrency.

## Lever 1 — perMessageDeflate

**Not run.** Verifying that core's socket.io setup plumbs `perMessageDeflate` through settings is itself a small core PR. Folded into the recommendation below.

## Lever 2 — `--max-old-space-size=4096` (NODE_OPTIONS)

Run as the `nodemem` matrix entry. Selected step-by-step diff vs baseline:

| Step | baseline p95 | nodemem p95 | Δ |
|---:|---:|---:|---:|
| 80 | 17 | 17 |  0 |
| 120 | 12 | 16 | +4 |
| 160 |  9 | 13 | +4 |
| 200 | 20 | 13 | -7 |

Noise within ±5 ms. RSS grows similarly. apply_mean and emits_NEW_CHANGES are essentially identical.

**Verdict: no measurable effect.** The user's hunch on the issue (memory is not the bottleneck) is confirmed. Don't recommend bumping the heap as a scaling lever.

## Lever 3 — fan-out batching

**Deferred.** Requires a code change in `PadMessageHandler.ts` (specifically the per-socket loop in `updatePadClients` and/or the broadcast emit at line 627). Recommended as the next concrete code change. The harness is ready to score it as soon as a candidate branch exists — point the workflow's `core_ref` input at the branch.

The `emits_new_changes` column on the curve table above is the direct measurement target. At 200 authors we're producing 66 032 emits per 10 s dwell. Halving the emit rate (by coalescing two changesets per emit on a sub-50 ms window) would directly reduce CPU.

## Lever 4 — `socketTransportProtocols: ["websocket"]`

Run as the `websocket-only` matrix entry. Selected step-by-step diff vs baseline:

| Step | baseline p95 | websocket-only p95 | Δ | baseline apply_mean | ws-only apply_mean |
|---:|---:|---:|---:|---:|---:|
|  20 | 11 | 10 |  -1 | 4.84 ms | 3.67 ms |
|  60 | 11 |  9 |  -2 | 4.63 ms | 3.28 ms |
| 100 | 16 | 13 |  -3 | 5.08 ms | 3.27 ms |
| 140 |  8 | 24 | **+16** | 3.96 ms | 5.13 ms |
| 180 | 16 | 35 | **+19** | 3.56 ms | 8.07 ms |
| 200 | 20 | 37 | **+17** | 3.67 ms | 8.77 ms |

Below ~100 authors, websocket-only is a modest win (-1 to -3 ms p95). Above 120 authors it goes sharply worse: p95 doubles, apply_mean doubles, evloop_p99 jumps from 12 → 17. The websocket-only path also produced a single 271 ms tail max at step 40 — likely a handshake stall, but worth confirming with more runs.

**Verdict: do not recommend dropping the polling fallback.** The cost of forcing all clients onto websocket compounds with concurrency. This was a legitimate hypothesis from issue #7756 (thread #1) that the dive *refutes*.

## Lever 5 — raw `ws` (drop socket.io entirely)

**Not pursued.** Lever 4 demonstrated that the transport choice within socket.io is already an inversion — dropping the polling fallback hurts. Ripping socket.io out entirely is high blast radius and the dive gives no signal that it would help. Defer indefinitely.

## Recommendation

In priority order:

1. **Prototype fan-out batching** (lever 3). The dive identifies fan-out as the single dominant cost. Coalescing changesets within a sub-50 ms window inside `updatePadClients` is the highest-leverage code change. Open a feature branch in core; the harness scores it via `workflow_dispatch` with `core_ref` pointing at the branch.
2. **Verify and run lever 1** (`perMessageDeflate`). Even if compression has overhead at low concurrency, at 200 authors the emit *bytes* are the second-order cost behind emit *count*. Worth scoring once lever 3 is in.
3. **Do not merge lever 4.** Keep `socketTransportProtocols: ["websocket", "polling"]` as the default.
4. **Do not merge lever 2.** No effect.
5. **Add core counters for fan-out byte size** as a small follow-up to #7762. The histogram of changeset bytes per emit would make lever 1 scorable without instrumenting client-side.

## Reproducing

```
# Trigger a dive run against any core ref.
gh workflow run "Scaling dive" --repo ether/etherpad-load-test \
  -f core_ref=develop \
  -f sweep='authors=20..200:step=20:dwell=10s:warmup=2s'

# Fetch artifacts.
gh run download <RUN_ID> --repo ether/etherpad-load-test
```

Per-lever CSV / JSON / MD artifacts drop in `scaling-dive-{baseline,websocket-only,nodemem}/`. The CSV is plot-ready; the JSON has the full per-step `Snapshot.gauges`.

## Out of scope (sequel issues worth filing)

- The `apply_mean` calculation uses `histogram._sum / histogram._count` for a simple mean. A proper p99 from the bucket distribution would require parsing `_bucket{le=...}` rows in the harness. Worth adding to the Scraper if lever 3 scoring needs it.
- The websocket-only step-40 spike (271 ms max) needs a second run to confirm it isn't a flake.
- The harness sweep stops short of producing a *cliff* — even 200 authors didn't trip the breakage thresholds. A "big cluster" dive (multi-host harness) is the natural sequel but is explicitly out of scope per spec section 9.
- Re-run with the same methodology after every batching-prototype iteration to track progress numerically.
