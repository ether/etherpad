'use strict';

/*
 * A tool for generating a test user session which can be used for debugging configs
 * that require sessions.
 */

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.
import fs from "node:fs";

import path from "node:path";

import querystring from "node:querystring";

import process from "node:process";


process.on('unhandledRejection', (err) => { throw err; });
import settings from 'ep_etherpad-lite/node/utils/Settings';
(async () => {
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

  const filePath = path.join(__dirname, '../APIKEY.txt');
  const apikey = fs.readFileSync(filePath, {encoding: 'utf-8'});

  let res;

  res = await apiGet('/api/');
  const apiVersion = res.currentVersion;
  if (!apiVersion) throw new Error('No version set in API');
  console.log('apiVersion', apiVersion);
  const uri = (cmd: string, args: querystring.ParsedUrlQueryInput ) => `/api/${apiVersion}/${cmd}?${querystring.stringify(args)}`;

  res = await apiPost(uri('createGroup', {apikey}));
  if (res.code === 1) throw new Error(`Error creating group: ${res}`);
  const groupID = res.data.groupID;
  console.log('groupID', groupID);

  res = await apiPost(uri('createGroupPad', {apikey, groupID}));
  if (res.code === 1) throw new Error(`Error creating group pad: ${res}`);
  console.log('Test Pad ID ====> ', res.data.padID);

  res = await apiPost(uri('createAuthor', {apikey}));
  if (res.code === 1) throw new Error(`Error creating author: ${res}`);
  const authorID = res.data.authorID;
  console.log('authorID', authorID);

  const validUntil = Math.floor(new Date().getTime()  / 1000) + 60000;
  console.log('validUntil', validUntil);
  res = await apiPost(uri('createSession', {apikey, groupID, authorID, validUntil}));
  if (res.code === 1) throw new Error(`Error creating session: ${JSON.stringify(res)}`);
  console.log('Session made: ====> create a cookie named sessionID and set the value to',
      res.data.sessionID);
  process.exit(0)
})();
