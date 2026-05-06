/*
* A tool for deleting ALL GROUP sessions Etherpad user sessions from the CLI,
* because sometimes a brick is required to fix a face.
*/

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.
import path from "node:path";

import fs from "node:fs";
import process from "node:process";

process.on('unhandledRejection', (err) => { throw err; });
// Set a delete counter which will increment on each delete attempt
// TODO: Check delete is successful before incrementing
let deleteCount = 0;

// get the API Key
const filePath = path.join(__dirname, '../APIKEY.txt');
console.log('Deleting all group sessions, please be patient.');
const settings = require('ep_etherpad-lite/tests/container/loadSettings').loadSettings();

(async () => {
  const apikey = fs.readFileSync(filePath, {encoding: 'utf-8'});
  const baseURL = `http://${settings.ip}:${settings.port}`;
  const apiGet = async (p: string): Promise<any> => {
    const r = await fetch(baseURL + p);
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.json();
  };
  const apiPost = async (p: string): Promise<any> => {
    const r = await fetch(baseURL + p, {method: 'POST'});
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.json();
  };

  const apiVersionResponse = await apiGet('/api/');
  const apiVersion = apiVersionResponse.currentVersion; // 1.12.5
  console.log('apiVersion', apiVersion);

  const groupsResponse = await apiGet(`/api/${apiVersion}/listAllGroups?apikey=${apikey}`);
  const groups = groupsResponse.data.groupIDs; // ['whateverGroupID']

  for (const groupID of groups) {
    const sessionURI = `/api/${apiVersion}/listSessionsOfGroup?apikey=${apikey}&groupID=${groupID}`;
    const sessionsResponse = await apiGet(sessionURI);
    const sessions = sessionsResponse.data;

    if(sessions == null) continue;

    for (const [sessionID, val] of Object.entries(sessions)) {
      if(val == null) continue;
      const deleteURI = `/api/${apiVersion}/deleteSession?apikey=${apikey}&sessionID=${sessionID}`;
      const c = await apiPost(deleteURI);
      console.log(c);
      deleteCount++;
    }
  }
  console.log(`Deleted ${deleteCount} sessions`);
  process.exit(0)
})();
