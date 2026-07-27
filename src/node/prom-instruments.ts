// Prometheus instruments referenced from the hot path (PadMessageHandler).
//
// Defined in a separate file so that PadMessageHandler can import the
// recording helpers without creating a circular import with prometheus.ts
// (which already requires PadMessageHandler to read sessioninfos).
//
// The metrics themselves are added to the central Registry by prometheus.ts.
//
// Everything here is gated behind settings.scalingDiveMetrics (default false).
// When the flag is off the recording helpers short-circuit to no-ops and the
// metrics are never registered, so production deployments don't pay for
// instrumentation they don't use.

import client from 'prom-client';
import settings from './utils/Settings';

export const enabled = (): boolean => settings.scalingDiveMetrics === true;

export const changesetApplyDuration = new client.Histogram({
  name: 'etherpad_changeset_apply_duration_seconds',
  help: 'Time spent applying an incoming USER_CHANGES message on the server (apply path only, excludes fan-out to other clients)',
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

// Allowlist of message-type label values. Anything outside this set is rolled
// into 'other' so a misbehaving plugin or HTTP-API caller passing a
// user-controlled msgString cannot explode prom-client's internal label-cardinality
// state.
const KNOWN_TYPES = new Set([
  'NEW_CHANGES',
  'ACCEPT_COMMIT',
  'CHAT_MESSAGE',
  'CLIENT_VARS',
  'CLIENT_MESSAGE',
  'CUSTOM',
  'USER_NEWINFO',
  'USERINFO_UPDATE',
  'USER_LEAVE',
]);

/** Start a timer for the changeset apply path. Call the returned function when done.
 *  Returns a no-op stopper when the feature flag is off. */
export const recordChangesetApply = (): (() => void) => {
  if (!enabled()) return () => {};
  return changesetApplyDuration.startTimer();
};

/** Increment the socket-emit counter for the given message type.
 *  No-op when the feature flag is off. Unknown/missing types are bucketed as
 *  'other' to keep label cardinality bounded. */
export const recordSocketEmit = (type: string | undefined): void => {
  if (!enabled()) return;
  const label = type && KNOWN_TYPES.has(type) ? type : 'other';
  socketEmitsTotal.labels(label).inc();
};
