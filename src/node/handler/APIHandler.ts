'use strict';
/**
 * The API Handler handles all API http requests
 */

/*
 * 2011 Peter 'Pita' Martischka (Primary Technology Ltd)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {MapArrayType} from "../types/MapType";
const api = require('../db/API');
const padManager = require('../db/PadManager');
import settings from '../utils/Settings';
import createHTTPError from 'http-errors';
import {Http2ServerRequest} from "node:http2";
import {publicKeyExported} from "../security/OAuth2Provider";
import {jwtVerify} from "jose";
import {APIFields, apikey} from './APIKeyHandler'
import crypto from 'node:crypto';
// a list of all functions
const version:MapArrayType<any> = {};

version['1'] = {
  createGroup: [],
  createGroupIfNotExistsFor: ['groupMapper'],
  deleteGroup: ['groupID'],
  listPads: ['groupID'],
  createPad: ['padID', 'text'],
  createGroupPad: ['groupID', 'padName', 'text'],
  createAuthor: ['name'],
  createAuthorIfNotExistsFor: ['authorMapper', 'name'],
  listPadsOfAuthor: ['authorID'],
  createSession: ['groupID', 'authorID', 'validUntil'],
  deleteSession: ['sessionID'],
  getSessionInfo: ['sessionID'],
  listSessionsOfGroup: ['groupID'],
  listSessionsOfAuthor: ['authorID'],
  getText: ['padID', 'rev'],
  setText: ['padID', 'text'],
  getHTML: ['padID', 'rev'],
  setHTML: ['padID', 'html'],
  getRevisionsCount: ['padID'],
  getLastEdited: ['padID'],
  deletePad: ['padID', 'deletionToken'],
  getReadOnlyID: ['padID'],
  setPublicStatus: ['padID', 'publicStatus'],
  getPublicStatus: ['padID'],
  listAuthorsOfPad: ['padID'],
  padUsersCount: ['padID'],
};

version['1.1'] = {
  ...version['1'],
  getAuthorName: ['authorID'],
  padUsers: ['padID'],
  sendClientsMessage: ['padID', 'msg'],
  listAllGroups: [],
};

version['1.2'] = {
  ...version['1.1'],
  checkToken: [],
};

version['1.2.1'] = {
  ...version['1.2'],
  listAllPads: [],
};

version['1.2.7'] = {
  ...version['1.2.1'],
  createDiffHTML: ['padID', 'startRev', 'endRev'],
  getChatHistory: ['padID', 'start', 'end'],
  getChatHead: ['padID'],
};

version['1.2.8'] = {
  ...version['1.2.7'],
  getAttributePool: ['padID'],
  getRevisionChangeset: ['padID', 'rev'],
};

version['1.2.9'] = {
  ...version['1.2.8'],
  copyPad: ['sourceID', 'destinationID', 'force'],
  movePad: ['sourceID', 'destinationID', 'force'],
};

version['1.2.10'] = {
  ...version['1.2.9'],
  getPadID: ['roID'],
};

version['1.2.11'] = {
  ...version['1.2.10'],
  getSavedRevisionsCount: ['padID'],
  listSavedRevisions: ['padID'],
  saveRevision: ['padID', 'rev'],
  restoreRevision: ['padID', 'rev'],
};

version['1.2.12'] = {
  ...version['1.2.11'],
  appendChatMessage: ['padID', 'text', 'authorID', 'time'],
};

version['1.2.13'] = {
  ...version['1.2.12'],
  appendText: ['padID', 'text'],
};

version['1.2.14'] = {
  ...version['1.2.13'],
  getStats: [],
};

version['1.2.15'] = {
  ...version['1.2.14'],
  copyPadWithoutHistory: ['sourceID', 'destinationID', 'force'],
};

version['1.3.0'] = {
  ...version['1.2.15'],
  appendText: ['padID', 'text', 'authorId'],
  copyPadWithoutHistory: ['sourceID', 'destinationID', 'force', 'authorId'],
  createGroupPad: ['groupID', 'padName', 'text', 'authorId'],
  createPad: ['padID', 'text', 'authorId'],
  restoreRevision: ['padID', 'rev', 'authorId'],
  setHTML: ['padID', 'html', 'authorId'],
  setText: ['padID', 'text', 'authorId'],
};

version['1.3.1'] = {
  ...version['1.3.0'],
  compactPad: ['padID', 'keepRevisions'],
  anonymizeAuthor: ['authorID'],
};

// set the latest available API version here
exports.latestApiVersion = '1.3.1';

// exports the versions so it can be used by the new Swagger endpoint
exports.version = version;



/**
 * Handles an HTTP API call
 * @param {String} apiVersion the version of the api
 * @param {String} functionName the name of the called function
 * @param fields the params of the called function
 * @param req express request object
 */
exports.handle = async function (apiVersion: string, functionName: string, fields: APIFields,
                                 req: Http2ServerRequest) {
  // say goodbye if this is an unknown API version
  if (!(apiVersion in version)) {
    throw new createHTTPError.NotFound('no such api version');
  }

  // say goodbye if this is an unknown function
  if (!(functionName in version[apiVersion])) {
    const compareVersions = (v1: string, v2: string): number => {
      const parts1 = v1.split('.').map(Number);
      const parts2 = v2.split('.').map(Number);
      const len = Math.max(parts1.length, parts2.length);
      for (let i = 0; i < len; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 !== p2) return p1 - p2;
      }
      return 0;
    };
    const sortedVersions = Object.keys(version).sort(compareVersions);
    const oldestVersion = sortedVersions.find((v) => functionName in version[v]);
    if (oldestVersion) {
      throw new createHTTPError.NotFound(
          `'${functionName}' is available from API v${oldestVersion} onwards.`);
    }
    throw new createHTTPError.NotFound('no such function');
  }



  if (apikey !== null && apikey.trim().length > 0) {
    fields.apikey = fields.apikey || fields.api_key || fields.authorization;
    // Constant-time compare — see crypto.timingSafeEqual docs.
    const provided = Buffer.from(String(fields.apikey ?? ''), 'utf8');
    const want = Buffer.from(apikey!.trim(), 'utf8');
    const ok = provided.length === want.length &&
        crypto.timingSafeEqual(provided, want);
    if (!ok) {
      throw new createHTTPError.Unauthorized('no or wrong API Key');
    }
  } else {
    if (!req.headers.authorization) {
      throw new createHTTPError.Unauthorized('no or wrong API Key');
    }
    try {
      const clientIds: string[] = settings.sso.clients?.map(
          (client: {client_id: string}) => client.client_id) ?? [];
      const jwtToCheck = req.headers.authorization.replace('Bearer ', '');
      // Verify the JWT signature first, then read claims off the verified
      // payload only.
      const {payload: verified} = await jwtVerify(
          jwtToCheck, publicKeyExported!, {algorithms: ['RS256']});
      const isClientCredentials =
          clientIds.includes(verified.sub as string);
      if (!isClientCredentials) {
        // authorization_code branch: require the admin claim to be
        // strictly true. Checking only that the claim is present is not
        // sufficient — the provider issues it as `admin: is_admin`, so
        // non-admin users would have it set to false.
        if (verified.admin !== true) {
          throw new createHTTPError.Unauthorized(
              'admin claim missing or not true');
        }
      }
    } catch (e) {
      // Single error string regardless of the underlying failure so we
      // don't leak which check rejected the token.
      throw new createHTTPError.Unauthorized('no or wrong OAuth token');
    }
  }

  // sanitize any padIDs before continuing
  if (fields.padID) {
    fields.padID = await padManager.sanitizePadId(fields.padID);
  }
  // there was an 'else' here before - removed it to ensure
  // that this sanitize step can't be circumvented by forcing
  // the first branch to be taken
  if (fields.padName) {
    fields.padName = await padManager.sanitizePadId(fields.padName);
  }

  // put the function parameters in an array
  // @ts-ignore
  const functionParams = version[apiVersion][functionName].map((field) => fields[field]);

  // call the api function
  return api[functionName].apply(this, functionParams);
};
