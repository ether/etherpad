import client from 'prom-client';
import dbModule from './db/DB.js';
import * as PadMessageHandler from './handler/PadMessageHandler.js';

const register = new client.Registry();
const gaugeDB = new client.Gauge({
  name: 'ueberdb_stats',
  help: 'ueberdb stats',
  labelNames: ['type'],
});
register.registerMetric(gaugeDB);

const totalUsersGauge = new client.Gauge({
  name: 'etherpad_total_users',
  help: 'Total number of users',
});
register.registerMetric(totalUsersGauge);

const activePadsGauge = new client.Gauge({
  name: 'etherpad_active_pads',
  help: 'Total number of active pads',
});
register.registerMetric(activePadsGauge);

// Added for the #7756 scaling dive: lets the load-test harness attribute
// where time goes (apply path vs. fan-out) and confirm per-pad concurrency.
// The metric handles live in prom-instruments.ts to avoid a circular import
// with PadMessageHandler (which records into them on the hot path).
// Gated behind settings.scalingDiveMetrics so production deployments don't
// pay for the instrumentation by default.
import {padUsersGauge, changesetApplyDuration, socketEmitsTotal, enabled as scalingDiveMetricsEnabled} from './prom-instruments.js';
if (scalingDiveMetricsEnabled()) {
  register.registerMetric(padUsersGauge);
  register.registerMetric(changesetApplyDuration);
  register.registerMetric(socketEmitsTotal);
}

client.collectDefaultMetrics({register});

const monitor = async function () {
  const db = dbModule.db;
  for (const [metric, value] of Object.entries(db.metrics)) {
    if (typeof value !== 'number') continue;
    gaugeDB.set({type: metric}, value);
  }
  activePadsGauge.set(PadMessageHandler.getActivePadCountFromSessionInfos());
  totalUsersGauge.set(PadMessageHandler.getTotalActiveUsers());
  if (scalingDiveMetricsEnabled()) {
    // Per-pad concurrency: reset to avoid stale labels for pads that drained.
    padUsersGauge.reset();
    for (const [padId, count] of PadMessageHandler.getPadUsersMap()) {
      padUsersGauge.set({padId}, count);
    }
  }
  return register;
};

export default monitor;
