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

import axios from 'axios'
import process from "node:process";


process.on('unhandledRejection', (err) => { throw err; });
import settings from 'ep_etherpad-lite/node/utils/Settings';
(async () => {
  axios.defaults.baseURL = `http://${settings.ip}:${settings.port}`;
  const api = axios;

  const filePath = path.join(__dirname, '../APIKEY.txt');
  const apikey = fs.readFileSync(filePath, {encoding: 'utf-8'});

  let res;

  res = await api.get('/api/');
  const apiVersion = res.data.currentVersion;
  if (!apiVersion) throw new Error('No version set in API');
  console.log('apiVersion', apiVersion);
  const uri = (cmd: string, args: querystring.ParsedUrlQueryInput ) => `/api/${apiVersion}/${cmd}?${querystring.stringify(args)}`;

  res = await api.post(uri('createGroup', {apikey}));
  if (res.data.code === 1) throw new Error(`Error creating group: ${res.data}`);
  const groupID = res.data.data.groupID;
  console.log('groupID', groupID);

  res = await api.post(uri('createGroupPad', {apikey, groupID}));
  if (res.data.code === 1) throw new Error(`Error creating group pad: ${res.data}`);
  console.log('Test Pad ID ====> ', res.data.data.padID);

  res = await api.post(uri('createAuthor', {apikey}));
  if (res.data.code === 1) throw new Error(`Error creating author: ${res.data}`);
  const authorID = res.data.data.authorID;
  console.log('authorID', authorID);

  const validUntil = Math.floor(new Date().getTime()  / 1000) + 60000;
  console.log('validUntil', validUntil);
  res = await api.post(uri('createSession', {apikey, groupID, authorID, validUntil}));
  if (res.data.code === 1) throw new Error(`Error creating session: ${JSON.stringify(res.data)}`);
  console.log('Session made: ====> create a cookie named sessionID and set the value to',
      res.data.data.sessionID);
  process.exit(0)
})();
