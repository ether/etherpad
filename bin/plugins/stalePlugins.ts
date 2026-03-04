'use strict';

// Returns a list of stale plugins and their authors email

import axios from 'axios'
import process from "node:process";
const currentTime = new Date();

(async () => {
  const res = await axios.get<string>('https://static.etherpad.org/plugins.full.json');
  for (const plugin of Object.keys(res.data)) {
    // @ts-ignore
    const name = res.data[plugin].data.name;
    // @ts-ignore
    const date = new Date(res.data[plugin].time);
    const diffTime = Math.abs(currentTime.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > (365 * 2)) {
      // @ts-ignore
      console.log(`${name}, ${res.data[plugin].data.maintainers[0].email}`);
    }
  }
  process.exit(0)
})();
