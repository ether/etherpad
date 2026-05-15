import client from 'prom-client';

const db = require('./db/DB').db;
const PadMessageHandler = require('./handler/PadMessageHandler');

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
import {padUsersGauge, changesetApplyDuration, socketEmitsTotal} from './prom-instruments';
register.registerMetric(padUsersGauge);
register.registerMetric(changesetApplyDuration);
register.registerMetric(socketEmitsTotal);

client.collectDefaultMetrics({register});

const monitor = async function () {
  for (const [metric, value] of Object.entries(db.metrics)) {
    if (typeof value !== 'number') continue;
    gaugeDB.set({type: metric}, value);
  }
  activePadsGauge.set(PadMessageHandler.getActivePadCountFromSessionInfos());
  totalUsersGauge.set(PadMessageHandler.getTotalActiveUsers());
  // Per-pad concurrency: reset to avoid stale labels for pads that drained.
  padUsersGauge.reset();
  for (const [padId, count] of PadMessageHandler.getPadUsersMap()) {
    padUsersGauge.set({padId}, count);
  }
  return register;
};

export default monitor;
