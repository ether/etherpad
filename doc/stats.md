# Statistics and metrics

Etherpad tracks runtime statistics about the edit machinery, the database
layer, and the Node.js process, and can expose them over HTTP for monitoring.

There are two endpoints:

- `GET /stats` — a JSON dump of the internal `measured-core` collection.
- `GET /stats/prometheus` — the same kind of data (plus process/runtime
  metrics) in the [Prometheus](https://prometheus.io/) text exposition format.

## Enabling the endpoints

Both endpoints are gated behind the `enableMetrics` setting, which defaults to
`true`:

```json
{
  "enableMetrics": true
}
```

When `enableMetrics` is `false` the routes are **not registered at all** — a
request to `/stats` or `/stats/prometheus` returns the normal 404 handling, not
an empty response. The admin-panel statistics view is unaffected by this
setting.

## `GET /stats` (JSON)

Returns the current snapshot of the `measured-core` collection as JSON. The
following metrics are collected:

| Metric | Type | Meaning |
| --- | --- | --- |
| `totalUsers` | gauge | Number of users currently connected across all pads. |
| `activePads` | gauge | Number of pads with at least one connected user. |
| `connects` | meter | Rate of new client connections. |
| `disconnects` | meter | Rate of client disconnections. |
| `rateLimited` | meter | Rate of messages dropped by the per-connection rate limiter. |
| `pendingEdits` | counter | Edits received but not yet fully processed. |
| `edits` | timer | Time taken to process an incoming `USER_CHANGES` edit (full handler span). |
| `failedChangesets` | meter | Rate of changesets that failed to apply. |
| `httpRequests` | timer | Duration of HTTP requests served by Express. |
| `http500` | meter | Rate of HTTP 500 responses. |
| `memoryUsage` | gauge | Process resident set size (`process.memoryUsage().rss`). |
| `memoryUsageHeap` | gauge | Process heap usage (`process.memoryUsage().heapUsed`). |
| `lastDisconnect` | gauge | Timestamp (ms) of the most recent socket disconnect. |
| `ueberdb_*` | gauge | One gauge per [ueberDB](https://github.com/ether/ueberDB) database statistic, e.g. read/write counts and timings (`ueberdb_reads`, `ueberdb_writes`, …). The exact set depends on the configured database driver. |

Under the hood these are provided by
[`measured-core`](https://github.com/yaorg/node-measured/tree/master/packages/measured-core).
To read or extend them from a plugin, require the shared collection:

```js
const stats = require('ep_etherpad-lite/node/stats');
// stats is a measured-core Collection
stats.counter('my_plugin_events').inc();
console.log(stats.toJSON());
```

## `GET /stats/prometheus` (Prometheus exposition format)

Served from a dedicated [`prom-client`](https://github.com/siimon/prom-client)
registry. This is the endpoint you point a Prometheus scraper at.

### Metrics exposed by default

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `etherpad_total_users` | gauge | — | Total number of connected users. |
| `etherpad_active_pads` | gauge | — | Total number of active pads. |
| `ueberdb_stats` | gauge | `type` | ueberDB statistics, one series per numeric ueberDB metric (the metric name is carried in the `type` label). |

In addition, the registry calls `prom-client`'s `collectDefaultMetrics()`, so
the standard Node.js / process metrics are also exposed, including (names as
emitted by `prom-client`):

- `process_cpu_user_seconds_total`, `process_cpu_system_seconds_total`,
  `process_cpu_seconds_total`
- `process_resident_memory_bytes`, `process_heap_bytes`,
  `process_virtual_memory_bytes`
- `process_open_fds`, `process_max_fds`
- `process_start_time_seconds`
- `nodejs_eventloop_lag_seconds` and the `nodejs_eventloop_lag_*` family
- `nodejs_active_handles`, `nodejs_active_requests`, `nodejs_active_resources`
  (and their `_total` variants)
- `nodejs_heap_size_total_bytes`, `nodejs_heap_size_used_bytes`,
  `nodejs_external_memory_bytes`, `nodejs_heap_space_size_*_bytes`
- `nodejs_gc_duration_seconds`
- `nodejs_version_info`

The exact default-metric set is determined by `prom-client` and the Node.js
version, not by Etherpad.

### Opt-in scaling-dive metrics (`scalingDiveMetrics`)

A second, more detailed instrument set was added for the scaling investigation
(PR #7756). It is gated behind the `scalingDiveMetrics` setting, which defaults
to `false`:

```json
{
  "scalingDiveMetrics": false
}
```

When the flag is off, these metrics are never registered and their recording
helpers short-circuit to no-ops, so production deployments pay nothing for the
instrumentation. When enabled, the following are added to the
`/stats/prometheus` output:

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `etherpad_changeset_apply_duration_seconds` | histogram | — | Time spent applying an incoming `USER_CHANGES` message on the server (apply path only; excludes fan-out to other clients). Buckets: 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5 seconds. |
| `etherpad_socket_emits_total` | counter | `type` | Number of socket.io broadcast emits, bucketed by message type. |
| `etherpad_pad_users` | gauge | `padId` | Active users connected to each pad, keyed by pad id. |

**Cardinality caution.** The scaling-dive metrics carry high-cardinality
labels:

- `etherpad_pad_users` adds one time series **per active pad** (`padId`
  label). On instances with many pads this can produce a large number of
  series; stale labels are reset on each scrape so drained pads drop out.
- `etherpad_socket_emits_total` uses the `type` label. To keep cardinality
  bounded, only a fixed allowlist of known message types is reported; any
  other (or missing) type is rolled into a single `other` bucket, so a
  misbehaving plugin or API caller cannot explode the label space.

Enable `scalingDiveMetrics` for targeted load-testing or capacity
investigations, not as a permanent production default.

## Scraping with Prometheus

Add a scrape job pointing at the `/stats/prometheus` endpoint, for example:

```yaml
scrape_configs:
  - job_name: etherpad
    metrics_path: /stats/prometheus
    static_configs:
      - targets: ['localhost:9001']
```

Make sure `enableMetrics` is `true` (the default) so the endpoint exists. If
your instance is reachable from untrusted networks, restrict access to
`/stats` and `/stats/prometheus` at your reverse proxy, since they expose
operational details about the deployment.
