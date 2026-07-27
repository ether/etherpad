'use strict';

// Returns a list of stale plugins and their authors email

import process from "node:process";
import settings from "../../src/node/utils/Settings";
const currentTime = new Date();

(async () => {
  if (!settings.privacy.pluginCatalog) {
    console.info(
      'stalePlugins: plugin catalog disabled by privacy.pluginCatalog=false; exiting'
    );
    process.exit(0);
  }
  const resp = await fetch(`${settings.updateServer}/plugins.full.json`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  const data: any = await resp.json();
  for (const plugin of Object.keys(data)) {
    const name = data[plugin].data.name;
    const date = new Date(data[plugin].time);
    const diffTime = Math.abs(currentTime.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > (365 * 2)) {
      console.log(`${name}, ${data[plugin].data.maintainers[0].email}`);
    }
  }
  process.exit(0)
})();
