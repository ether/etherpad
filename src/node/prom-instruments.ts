// Prometheus instruments referenced from the hot path (PadMessageHandler).
//
// Defined in a separate file so that PadMessageHandler can import the
// recording helpers without creating a circular import with prometheus.ts
// (which already requires PadMessageHandler to read sessioninfos).
//
// The metrics themselves are added to the central Registry by prometheus.ts.

import client from 'prom-client';

export const changesetApplyDuration = new client.Histogram({
  name: 'etherpad_changeset_apply_duration_seconds',
  help: 'Time spent applying an incoming USER_CHANGES message on the server',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5],
});

export const socketEmitsTotal = new client.Counter({
  name: 'etherpad_socket_emits_total',
  help: 'Number of socket.io broadcast emits, bucketed by message type',
  labelNames: ['type'],
});

export const padUsersGauge = new client.Gauge({
  name: 'etherpad_pad_users',
  help: 'Active users connected to a pad, keyed by padId',
  labelNames: ['padId'],
});

/** Start a timer for the changeset apply path. Call the returned function when done. */
export const recordChangesetApply = (): (() => void) =>
  changesetApplyDuration.startTimer();

/** Increment the socket-emit counter for the given message type. */
export const recordSocketEmit = (type: string | undefined): void => {
  socketEmitsTotal.labels(type || 'unknown').inc();
};
