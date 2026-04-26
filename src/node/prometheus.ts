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

client.collectDefaultMetrics({register});

const monitor = async function () {
  const db = dbModule.db;
  for (const [metric, value] of Object.entries(db.metrics)) {
    if (typeof value !== 'number') continue;
    gaugeDB.set({type: metric}, value);
  }
  activePadsGauge.set(PadMessageHandler.getActivePadCountFromSessionInfos());
  totalUsersGauge.set(PadMessageHandler.getTotalActiveUsers());
  return register;
};

export default monitor;
