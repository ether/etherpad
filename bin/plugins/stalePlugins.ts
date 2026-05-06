'use strict';

// Returns a list of stale plugins and their authors email

import process from "node:process";
const currentTime = new Date();

(async () => {
  const resp = await fetch('https://static.etherpad.org/plugins.full.json');
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
